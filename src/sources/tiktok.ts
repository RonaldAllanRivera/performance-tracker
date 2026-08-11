import type { TrackedVideo, VideoStats } from '../types.js';
import { NotImplementedError, type Source } from './types.js';

/**
 * TikTok ingestion -- NOT IMPLEMENTED. Deliberately.
 *
 * WHY NOT: TikTok has no free official API for public video statistics. The
 * Display API only returns videos owned by the authenticated account, which is
 * the creator, not us. Research API access is granted to academic institutions.
 * That leaves scraping, and scraping TikTok means headless browsers, rotating
 * proxies, and markup that changes without notice -- a maintained system in its
 * own right, not an afternoon's work inside a four-hour prototype.
 *
 * WHAT I DID INSTEAD: TikTok links are still accepted by the sheet reader and
 * still validated, so ops can keep one list rather than two. They are counted
 * and named in the daily digest as pending, so nobody assumes they are being
 * tracked. Silence would have been the dangerous option here.
 *
 * WHEN THIS GETS BUILT, in rough order of cost:
 *  1. Resolve vm.tiktok.com / vt.tiktok.com share links to canonical video
 *     ids first, or the same video gets tracked twice under two ids
 *     (see inputs/urls.ts).
 *  2. Try the oEmbed endpoint -- it is public and stable, but returns only
 *     title and author, no counts. Useful for labelling, not for trends.
 *  3. For counts, either buy a data provider (Apify, Bright Data, Ensemble)
 *     or run Playwright against the public page. Buying is the right call at
 *     agency scale: the cost is a rounding error against one engineer-day a
 *     month of unblocking scrapers.
 *
 * The Source interface is what makes this a file swap rather than a refactor.
 */
export function createTikTokSource(): Source {
  return {
    platform: 'tiktok',

    async fetchStats(videos: TrackedVideo[]): Promise<VideoStats[]> {
      throw new NotImplementedError(
        `TikTok ingestion is not implemented (${videos.length} video(s) pending). ` +
          'See src/sources/tiktok.ts for the approach and why it was deferred.',
      );
    },
  };
}
