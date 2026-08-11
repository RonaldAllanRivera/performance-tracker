/**
 * Shared vocabulary for the pipeline.
 *
 * Data flows in one direction and changes shape at each step:
 *
 *   Sheet row  -> TrackedVideo   (what ops asked us to watch)
 *   API call   -> VideoStats     (what the platform says today)
 *   storage    -> Snapshot       (what we recorded, one per video per day)
 *   analyze    -> Analysis       (what changed since last time, and is it notable)
 *   assemble   -> Report         (everything the digest and the notifier need)
 */

export type Platform = 'youtube' | 'tiktok';

/** A row from the tracking sheet that we successfully understood. */
export interface TrackedVideo {
  /** Platform-native video id, extracted from the URL. Unique per platform. */
  videoId: string;
  platform: Platform;
  url: string;
  campaign: string;
  creator: string;
  addedBy: string;
  /** 1-based sheet row, so warnings can point ops at the row to fix. */
  row: number;
}

/**
 * Why a video has no usable numbers. Both are normal, not errors:
 * a creator can delete a video, and YouTube lets owners hide view counts.
 */
export type VideoStatus = 'ok' | 'unavailable' | 'stats_hidden';

/** What a Source returns for one video on one run. */
export interface VideoStats {
  videoId: string;
  status: VideoStatus;
  title: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

/**
 * One video's numbers on one day. The unit of history.
 *
 * `pctViews` is stored rather than recomputed so that stall detection needs
 * only one lookback: "was it growing yesterday?" is answered by yesterday's
 * row, not by re-fetching the day before that.
 */
export interface Snapshot {
  videoId: string;
  platform: Platform;
  url: string;
  campaign: string;
  creator: string;
  /** YYYY-MM-DD in the configured timezone. Half of the idempotency key. */
  date: string;
  title: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Day-over-day view growth as a fraction (0.5 = +50%). Null on a baseline run. */
  pctViews: number | null;
  status: VideoStatus;
  fetchedAt: Date;
}

/**
 * Why a video is worth a human's attention. Absence of flags is the
 * common case and is not reported.
 */
export type Flag = 'spike' | 'stalled' | 'unavailable' | 'stats_hidden';

/**
 * Change since the previous snapshot. Views are always present when deltas
 * exist at all; likes and comments are nullable because creators can hide
 * those counts independently, and null there means "not published", not zero.
 */
export interface Deltas {
  views: number;
  likes: number | null;
  comments: number | null;
}

/** One video's story since the previous snapshot. */
export interface Analysis {
  videoId: string;
  platform: Platform;
  url: string;
  campaign: string;
  creator: string;
  title: string | null;
  status: VideoStatus;
  views: number | null;
  /** Null when this is the first run for the video, or when stats are unusable. */
  deltas: Deltas | null;
  pctViews: number | null;
  /**
   * Gap between this snapshot and the one it was compared against. Normally 1.
   * Anything higher means the job missed a day and the deltas cover a longer
   * window than "day over day" implies -- see analyze.ts.
   */
  daysSincePrevious: number | null;
  /** True on the first sighting of a video: recorded, but nothing to compare to. */
  isBaseline: boolean;
  flags: Flag[];
}

/** Something ops should know about, surfaced in the digest rather than a log. */
export interface Warning {
  kind: 'invalid_row' | 'unsupported_platform' | 'duplicate' | 'unavailable' | 'stats_hidden' | 'fetch_failed';
  message: string;
}

/** Everything the digest writer and the notifier need. Fully computed, no I/O. */
export interface Report {
  date: string;
  analyses: Analysis[];
  warnings: Warning[];
  totals: {
    videosTracked: number;
    totalViews: number;
    totalViewsDelta: number;
  };
  /** Biggest absolute view gains this run, already sorted and truncated. */
  topMovers: Analysis[];
  flagged: Analysis[];
}

/** A Report plus its human-readable summary. */
export interface DigestedReport extends Report {
  digest: string;
  /** Which path produced the prose. Worth monitoring: a rising 'template' rate
   *  means the digest is quietly degrading while still appearing to work. */
  digestSource: 'llm' | 'template';
}
