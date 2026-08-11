import { analyzeVideo, buildReport } from './analyze.js';
import { loadConfig, localTime, today, utcOffsetHours, type Config } from './config.js';
import { writeDigest } from './digest.js';
import { buildSeedSnapshots, createFixtureYouTubeSource, FIXTURE_SHEET_ROWS } from './fixtures/index.js';
import { parseRows, readTrackedVideos, type TrackedVideoSet } from './inputs/sheet.js';
import { logger } from './log.js';
import { createConsoleNotifier } from './notifiers/console.js';
import { createDiscordNotifier } from './notifiers/discord.js';
import type { Notifier } from './notifiers/types.js';
import { createStore } from './storage.js';
import { createTikTokSource } from './sources/tiktok.js';
import { NotImplementedError, type Source } from './sources/types.js';
import { createYouTubeSource } from './sources/youtube.js';
import type { Analysis, Platform, TrackedVideo, VideoStats, Warning } from './types.js';

/**
 * The daily pipeline: read the sheet, fetch today's numbers, compare them with
 * yesterday's, store the result, summarise it, post it.
 *
 * ERROR PHILOSOPHY
 *   Partial failure is tolerated and reported. One unreadable video, one bad
 *   sheet row, or one platform being down must not cost us the other fifty
 *   videos -- the problem is collected as a warning and ends up in the same
 *   Discord message as the good news, because a separate errors channel is a
 *   channel that gets muted.
 *
 *   Total failure is loud. Bad config, an unreachable database, or a failed
 *   Discord post exits non-zero so the Actions run goes red and someone finds
 *   out. Failing quietly is the one outcome worse than failing.
 */

const log = logger('job');

async function run(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  const date = today();

  const offset = utcOffsetHours(config.timezone);
  log.info(
    `starting run for ${date} — ${config.timezone} ` +
      `(UTC${offset >= 0 ? '+' : ''}${offset}, local time ${localTime(config.timezone)})` +
      `${config.dryRun ? ' — dry run: no credentials, no writes, no posting' : ''}`,
  );

  const store = createStore(config, config.dryRun ? buildSeedSnapshots(date) : []);
  await store.init();

  try {
    // 1. What are we tracking?
    const { videos, warnings } = await loadTrackedVideos(config);
    log.info(`tracking ${videos.length} video(s), ${warnings.length} input warning(s)`);

    // 2. What do the platforms say today?
    const { statsById, fetchWarnings } = await fetchAllStats(videos, config);
    warnings.push(...fetchWarnings);

    // 3. What changed since last time, and is any of it worth saying?
    const fetchedAt = new Date();
    const analyses: Analysis[] = [];

    for (const video of videos) {
      const stats = statsById.get(video.videoId);
      // Already reported at the platform level; skipping here avoids saying
      // the same thing twice in one message.
      if (!stats) continue;

      const previous = await store.getPreviousSnapshot(video.videoId, date);
      const { analysis, snapshot } = analyzeVideo(video, stats, previous, date, fetchedAt);

      // Written before the digest is built, so a later failure in the digest
      // or the webhook never costs us the day's data.
      await store.upsertSnapshot(snapshot);
      analyses.push(analysis);
    }

    log.info(`${analyses.length} snapshot(s) recorded`);

    // 4. Summarise and deliver.
    const report = buildReport(date, analyses, warnings);
    log.info(`${report.flagged.length} flagged, ${report.warnings.length} warning(s)`);

    const digested = await writeDigest(report, config);
    await createNotifier(config).send(digested);

    log.info(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } finally {
    await store.close();
  }
}

async function loadTrackedVideos(config: Config): Promise<TrackedVideoSet> {
  // The fixture path goes through the same parseRows() as the live path, so a
  // dry run genuinely tests validation instead of stepping around it.
  return config.dryRun ? parseRows(FIXTURE_SHEET_ROWS) : readTrackedVideos(config);
}

/**
 * Fetch every platform's numbers, one Source at a time.
 *
 * A Source that fails takes only its own platform down with it. A Source that
 * is not implemented yet says so in plain language rather than throwing an
 * engineering error at a campaign manager.
 */
async function fetchAllStats(
  videos: TrackedVideo[],
  config: Config,
): Promise<{ statsById: Map<string, VideoStats>; fetchWarnings: Warning[] }> {
  const sources: Record<Platform, Source> = {
    youtube: config.dryRun ? createFixtureYouTubeSource() : createYouTubeSource(config.youtubeApiKey),
    tiktok: createTikTokSource(),
  };

  const byPlatform = new Map<Platform, TrackedVideo[]>();
  for (const video of videos) {
    const group = byPlatform.get(video.platform) ?? [];
    group.push(video);
    byPlatform.set(video.platform, group);
  }

  const statsById = new Map<string, VideoStats>();
  const fetchWarnings: Warning[] = [];

  for (const [platform, group] of byPlatform) {
    try {
      for (const stats of await sources[platform].fetchStats(group)) {
        statsById.set(stats.videoId, stats);
      }
    } catch (error) {
      if (error instanceof NotImplementedError) {
        fetchWarnings.push({
          kind: 'unsupported_platform',
          message: `${group.length} ${platform} link(s) in the sheet are not tracked yet — ingestion is on the roadmap`,
        });
      } else {
        // Deliberately not fatal: YouTube being down should not stop us
        // reporting on everything else, and it should not be silent either.
        log.error(`${platform} fetch failed:`, describe(error));
        fetchWarnings.push({
          kind: 'fetch_failed',
          message: `Could not read ${platform} stats for ${group.length} video(s) — no data recorded for them today`,
        });
      }
    }
  }

  return { statsById, fetchWarnings };
}

function createNotifier(config: Config): Notifier {
  return config.dryRun ? createConsoleNotifier() : createDiscordNotifier(config.discordWebhookUrl);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

run().catch((error: unknown) => {
  log.error(describe(error));
  if (error instanceof Error && error.stack) console.error(error.stack);
  // Non-zero exit turns the Actions run red. The alternative is a job that
  // fails every morning and looks exactly like a job that had nothing to say.
  process.exitCode = 1;
});
