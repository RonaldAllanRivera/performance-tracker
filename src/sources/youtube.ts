import { logger } from '../log.js';
import type { TrackedVideo, VideoStats } from '../types.js';
import type { Source } from './types.js';

/**
 * YouTube Data API v3, videos.list.
 *
 * QUOTA: videos.list costs 1 unit per *call*, not per video, and the default
 * project allowance is 10,000 units/day. Because ids batch 50 at a time, one
 * daily run over 500 tracked videos costs 10 units -- 0.1% of quota. This is
 * not a constraint worth engineering around at any plausible campaign size.
 */

const log = logger('youtube');

const ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
/** Hard API limit: videos.list accepts at most 50 ids per request. */
const BATCH_SIZE = 50;
const TIMEOUT_MS = 15_000;

interface YouTubeItem {
  id?: string;
  snippet?: { title?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  status?: { privacyStatus?: string };
}

interface YouTubeResponse {
  items?: YouTubeItem[];
  error?: { message?: string };
}

export function createYouTubeSource(apiKey: string): Source {
  return {
    platform: 'youtube',

    async fetchStats(videos: TrackedVideo[]): Promise<VideoStats[]> {
      if (videos.length === 0) return [];

      const batches = chunk(
        videos.map((v) => v.videoId),
        BATCH_SIZE,
      );
      log.info(`fetching ${videos.length} video(s) in ${batches.length} request(s)`);

      const results: VideoStats[] = [];
      let succeeded = 0;

      for (const [index, ids] of batches.entries()) {
        try {
          results.push(...(await fetchBatch(ids, apiKey)));
          succeeded += 1;
        } catch (error) {
          // Omit rather than guess -- see the Source contract. The job turns
          // the resulting gap into a warning.
          log.error(`batch ${index + 1}/${batches.length} failed:`, describe(error));
        }
      }

      if (succeeded === 0) {
        throw new Error(`YouTube API unreachable: all ${batches.length} request(s) failed`);
      }

      return results;
    },
  };
}

async function fetchBatch(ids: string[], apiKey: string): Promise<VideoStats[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('part', 'snippet,statistics,status');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('key', apiKey);

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await response.json().catch(() => ({}))) as YouTubeResponse;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.error?.message ?? response.statusText}`);
  }

  const items = body.items ?? [];
  const byId = new Map(items.filter((item) => item.id).map((item) => [item.id as string, item]));

  return ids.map((id) => {
    const item = byId.get(id);

    // A deleted or private video is simply absent from a 200 response. This is
    // the normal way YouTube reports it -- there is no error to catch.
    if (!item) {
      return { videoId: id, status: 'unavailable', title: null, views: null, likes: null, comments: null };
    }

    const title = item.snippet?.title ?? null;
    const views = toCount(item.statistics?.viewCount);

    // Owners can hide public statistics. When they do, viewCount is simply
    // absent from an otherwise healthy response. Without this branch that
    // becomes Number(undefined) -> NaN, and NaN propagates silently through
    // every delta and into the digest.
    if (views === null) {
      log.warn(`${id}: statistics hidden by the video owner`);
      return { videoId: id, status: 'stats_hidden', title, views: null, likes: null, comments: null };
    }

    return {
      videoId: id,
      status: 'ok',
      title,
      views,
      // Likes and comments can be hidden independently of views; null here
      // means "not published", not "zero".
      likes: toCount(item.statistics?.likeCount),
      comments: toCount(item.statistics?.commentCount),
    };
  });
}

/** API counts arrive as strings. Anything not a finite number becomes null. */
function toCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
