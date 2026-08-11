import type { TrackedVideo, VideoStats } from '../types.js';

/**
 * A Source knows how to turn tracked videos into today's numbers for one
 * platform. This is the extension point for "we'll need more data sources
 * later": Instagram becomes instagram.ts, nothing else changes.
 *
 * One method, on purpose. A plugin framework with registration and lifecycle
 * hooks would be more impressive and less useful -- there are two platforms.
 *
 * CONTRACT:
 *  - Return one VideoStats per video you could resolve, in any order.
 *  - A deleted or private video is a *successful* result with status
 *    'unavailable'. It is real information and gets recorded.
 *  - If you could not reach the platform at all, OMIT those videos rather than
 *    guessing. A missing entry means "we don't know", which the job reports as
 *    a warning and skips. Marking an unreachable video 'unavailable' would
 *    write a false fact into history, which is worse than a gap.
 *  - Throw only when nothing could be fetched at all.
 */
export interface Source {
  readonly platform: string;
  fetchStats(videos: TrackedVideo[]): Promise<VideoStats[]>;
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
