import { RULES } from './rules.js';
import type { Analysis, Flag, Report, Snapshot, TrackedVideo, VideoStats, Warning } from './types.js';

/**
 * The only part of this system that decides anything.
 *
 * Everything in here is a pure function of its arguments -- no clock, no
 * network, no database -- which is why it is the one module with tests. If the
 * numbers in the Discord message are ever wrong, they are wrong here, and this
 * is where you can prove it in a unit test instead of by waiting a day.
 *
 * Deliberately, the LLM never touches any of this. It receives the output.
 */

export interface AnalyzeResult {
  analysis: Analysis;
  /** The row to persist. Carries `pctViews` forward so tomorrow's stall check
   *  needs one lookback instead of two. */
  snapshot: Snapshot;
}

/** Calendar days between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / 86_400_000);
}

function toUtcMillis(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  // Dates here are calendar labels, not instants. Anchoring them to UTC noon-
  // free midnight keeps the arithmetic immune to DST anywhere.
  return Date.UTC(year, month - 1, day);
}

export function analyzeVideo(
  video: TrackedVideo,
  stats: VideoStats,
  previous: Snapshot | null,
  date: string,
  fetchedAt: Date,
): AnalyzeResult {
  const base = {
    videoId: video.videoId,
    platform: video.platform,
    url: video.url,
    campaign: video.campaign,
    creator: video.creator,
    // Carry the last known title forward. A deleted video returns no title at
    // all, and "(untitled) is no longer viewable" tells ops nothing about which
    // video to go and look at -- the one case where the title matters most is
    // the one case the API stops giving us one.
    title: stats.title ?? previous?.title ?? null,
    status: stats.status,
    views: stats.views,
  };

  // A video we cannot read is still worth recording -- knowing *when* it went
  // private is the useful part -- but there is nothing to compare.
  if (stats.status !== 'ok' || stats.views === null) {
    const flags: Flag[] = stats.status === 'ok' ? [] : [stats.status];
    return {
      analysis: {
        ...base,
        deltas: null,
        pctViews: null,
        daysSincePrevious: previous ? daysBetween(previous.date, date) : null,
        isBaseline: previous === null,
        flags,
      },
      snapshot: { ...base, date, likes: stats.likes, comments: stats.comments, pctViews: null, fetchedAt },
    };
  }

  const views = stats.views;

  // Either the first time we have seen this video, or the last thing we
  // recorded had no usable numbers. Record a baseline and say nothing.
  if (previous === null || previous.views === null) {
    return {
      analysis: {
        ...base,
        deltas: null,
        pctViews: null,
        daysSincePrevious: previous ? daysBetween(previous.date, date) : null,
        isBaseline: previous === null,
        flags: [],
      },
      snapshot: { ...base, date, likes: stats.likes, comments: stats.comments, pctViews: null, fetchedAt },
    };
  }

  const daysSincePrevious = daysBetween(previous.date, date);
  const deltaViews = views - previous.views;
  const deltas = {
    views: deltaViews,
    likes: subtract(stats.likes, previous.likes),
    comments: subtract(stats.comments, previous.comments),
  };

  // Undefined rather than zero when there is nothing to grow from: a video
  // going 0 -> 500 has infinite percentage growth, which is not a useful
  // number. The absolute delta still carries that case (see spike below).
  const pctViews = previous.views > 0 ? deltaViews / previous.views : null;

  return {
    analysis: {
      ...base,
      deltas,
      pctViews,
      daysSincePrevious,
      isBaseline: false,
      flags: detectFlags({ pctViews, deltaViews, daysSincePrevious, previous }),
    },
    snapshot: { ...base, date, likes: stats.likes, comments: stats.comments, pctViews, fetchedAt },
  };
}

function detectFlags(input: {
  pctViews: number | null;
  deltaViews: number;
  daysSincePrevious: number;
  previous: Snapshot;
}): Flag[] {
  const { pctViews, deltaViews, daysSincePrevious, previous } = input;
  const flags: Flag[] = [];

  // Growth *rates* are only comparable across equal windows. If the job missed
  // a day, three days of ordinary growth reads as a one-day spike, and a video
  // that was flat all week reads as stalling for the first time. The delta is
  // still reported; only the rate-based judgements are withheld.
  if (daysSincePrevious > RULES.MAX_GAP_DAYS_FOR_RATE_FLAGS) return flags;

  const bigEnoughToMatter = deltaViews >= RULES.SPIKE_MIN_ABS;
  const grewSharply = pctViews !== null && pctViews >= RULES.SPIKE_PCT;
  // `previous.views === 0` is the from-nothing case that has no percentage.
  const startedFromZero = pctViews === null;

  if (bigEnoughToMatter && (grewSharply || startedFromZero)) flags.push('spike');

  // A *transition*, not a state. The video must have been growing yesterday to
  // be reported as stalling today, so each stall is announced once instead of
  // every morning for the rest of the video's life.
  const wasGrowing = previous.pctViews !== null && previous.pctViews >= RULES.STALL_WAS_GROWING;
  const hasStopped = pctViews !== null && pctViews < RULES.STALL_PCT;
  if (wasGrowing && hasStopped) flags.push('stalled');

  return flags;
}

function subtract(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

/** Roll individual analyses up into the totals the digest and embed need. */
export function buildReport(date: string, analyses: Analysis[], warnings: Warning[]): Report {
  const totalViews = sum(analyses.map((a) => a.views));
  const totalViewsDelta = sum(analyses.map((a) => a.deltas?.views ?? null));

  const topMovers = analyses
    .filter((a) => (a.deltas?.views ?? 0) > 0)
    .sort((a, b) => (b.deltas?.views ?? 0) - (a.deltas?.views ?? 0))
    .slice(0, RULES.TOP_MOVERS);

  return {
    date,
    analyses,
    warnings,
    totals: { videosTracked: analyses.length, totalViews, totalViewsDelta },
    topMovers,
    flagged: analyses.filter((a) => a.flags.length > 0),
  };
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
