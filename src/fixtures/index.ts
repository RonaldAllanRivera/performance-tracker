import { parseYouTubeResponse, type YouTubeResponse } from '../sources/youtube.js';
import type { Source } from '../sources/types.js';
import type { Snapshot, TrackedVideo, VideoStats } from '../types.js';

/**
 * Demo data for `--dry-run`.
 *
 * The point of this file is that `npm i && npm run job:dry` works on a fresh
 * clone with no credentials, no database, and no network. A reviewer or a new
 * maintainer can watch the whole pipeline run before asking anyone for keys.
 *
 * The data is deliberately built so a single run exercises every branch that
 * matters: a spike, a stall, ordinary growth, a deleted video, a video with
 * hidden statistics, a brand-new video with no history, a pending TikTok link,
 * and three rows that should be rejected. If a run stops showing all of those,
 * something has regressed.
 */

/** Rows exactly as Sheets would return them: `Tracked!A2:E`, values only. */
export const FIXTURE_SHEET_ROWS: string[][] = [
  // --- rows that should work ---
  ['https://youtu.be/gv3Qx7mNp0A', 'Govee Q3 Launch', 'maya.reyes', 'ops@contentlab'],
  ['https://www.youtube.com/watch?v=lu5Kd2wRt8B', 'Govee Q3 Launch', 'luis.tan', 'ops@contentlab'],
  ['https://www.youtube.com/shorts/an9Fj4sVy1C', 'Genshin Summer', 'ana.cruz', 'ops@contentlab'],
  ['https://youtu.be/to2Bh6nZq3D', 'Genshin Summer', 'tomas.lim', 'ops@contentlab'],
  ['https://youtu.be/ra7Cw1kXe5E', 'Guess Denim', 'rae.santos', 'ops@contentlab'],
  ['https://youtu.be/ki4Nm8pLu2F', 'Guess Denim', 'kit.navarro', 'ops@contentlab'],

  // Accepted and validated, but not ingested yet -- reported as pending so
  // nobody assumes it is being tracked. See src/sources/tiktok.ts.
  ['https://www.tiktok.com/@rae.santos/video/7239485712398471234', 'Guess Denim', 'rae.santos', 'ops@contentlab'],

  // --- rows that should be rejected, each for a different reason ---
  ['https://vimeo.com/123456789', 'Guess Denim', 'external.partner', 'ops@contentlab'],
  ['ask marco for the link', 'Genshin Summer', 'pending.creator', 'ops@contentlab'],
  ['https://www.youtube.com/watch?v=gv3Qx7mNp0A', 'Govee Q3 Launch', 'maya.reyes', 'ops@contentlab'],

  // Blank spacer row: normal in a human-maintained sheet, and silent.
  [],
];

/**
 * A YouTube `videos.list` response shaped exactly as the API returns one.
 *
 * Note what is NOT here: `to2Bh6nZq3D` is absent entirely (that is how the API
 * reports a deleted or private video -- a 200 with the item missing), and
 * `ra7Cw1kXe5E` has no `viewCount` (that is how it reports statistics the
 * owner has hidden).
 */
const FIXTURE_YOUTUBE_RESPONSE: YouTubeResponse = {
  items: [
    {
      id: 'gv3Qx7mNp0A',
      snippet: { title: 'Govee RGB strip — 60 second setup' },
      statistics: { viewCount: '31500', likeCount: '2410', commentCount: '188' },
      status: { privacyStatus: 'public' },
    },
    {
      id: 'lu5Kd2wRt8B',
      snippet: { title: 'I lit my whole apartment for under $100' },
      statistics: { viewCount: '48180', likeCount: '3902', commentCount: '441' },
      status: { privacyStatus: 'public' },
    },
    {
      id: 'an9Fj4sVy1C',
      snippet: { title: 'Genshin 5.0 first impressions #shorts' },
      statistics: { viewCount: '9100', likeCount: '812', commentCount: '96' },
      status: { privacyStatus: 'public' },
    },
    {
      id: 'ra7Cw1kXe5E',
      snippet: { title: 'Denim haul — Guess AW' },
      // Owner has hidden public statistics: no viewCount at all.
      statistics: { likeCount: '140' },
      status: { privacyStatus: 'public' },
    },
    {
      id: 'ki4Nm8pLu2F',
      snippet: { title: 'Styling one pair of jeans five ways' },
      statistics: { viewCount: '1250', likeCount: '96', commentCount: '11' },
      status: { privacyStatus: 'public' },
    },
  ],
};

/** A Source backed by the fixture, running the real response parser. */
export function createFixtureYouTubeSource(): Source {
  return {
    platform: 'youtube',
    async fetchStats(videos: TrackedVideo[]): Promise<VideoStats[]> {
      return parseYouTubeResponse(
        videos.map((v) => v.videoId),
        FIXTURE_YOUTUBE_RESPONSE,
      );
    },
  };
}

/**
 * Yesterday's snapshots, so the dry run shows real deltas and anomalies rather
 * than six baselines. Dates are computed relative to the run so the demo reads
 * correctly whenever it is run.
 *
 * `ki4Nm8pLu2F` is deliberately absent: it is the brand-new video.
 */
export function buildSeedSnapshots(today: string): Snapshot[] {
  const date = shiftDays(today, -1);
  const fetchedAt = new Date(`${date}T01:00:00.000Z`);

  const seed = (
    videoId: string,
    campaign: string,
    creator: string,
    title: string,
    views: number,
    pctViews: number | null,
  ): Snapshot => ({
    videoId,
    platform: 'youtube',
    url: `https://youtu.be/${videoId}`,
    campaign,
    creator,
    date,
    title,
    views,
    likes: null,
    comments: null,
    pctViews,
    status: 'ok',
    fetchedAt,
  });

  return [
    // 12,000 -> 31,500 today: a genuine spike, well over the absolute floor.
    seed('gv3Qx7mNp0A', 'Govee Q3 Launch', 'maya.reyes', 'Govee RGB strip — 60 second setup', 12_000, 0.08),
    // Was growing at +22%/day, adds only 180 views today: a stall *transition*.
    seed('lu5Kd2wRt8B', 'Govee Q3 Launch', 'luis.tan', 'I lit my whole apartment for under $100', 48_000, 0.22),
    // Ordinary growth. Should appear in top movers and NOT in anomalies.
    seed('an9Fj4sVy1C', 'Genshin Summer', 'ana.cruz', 'Genshin 5.0 first impressions #shorts', 8_400, 0.05),
    // Was fine yesterday, gone today.
    seed('to2Bh6nZq3D', 'Genshin Summer', 'tomas.lim', 'Genshin 5.0 co-op night with the squad', 5_000, 0.03),
    // Was fine yesterday, statistics hidden today.
    seed('ra7Cw1kXe5E', 'Guess Denim', 'rae.santos', 'Denim haul — Guess AW', 3_200, 0.04),
  ];
}

/** Shift a YYYY-MM-DD date by whole days, staying in calendar space. */
function shiftDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}
