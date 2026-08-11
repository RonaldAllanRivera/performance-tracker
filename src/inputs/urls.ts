import type { Platform } from '../types.js';

/**
 * URL parsing, kept pure and separate from the Sheets I/O.
 *
 * This is one of exactly two places where untrusted input enters the system
 * (the other is the platform API response), so it is unit-tested and it never
 * throws -- it returns a reason instead, and the reason ends up in the Discord
 * digest next to the sheet row that needs fixing.
 */

export type ParsedUrl =
  | { ok: true; platform: Platform; videoId: string }
  | { ok: false; reason: string };

/** YouTube ids are 11 chars of URL-safe base64. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

export function parseVideoUrl(raw: string): ParsedUrl {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty URL' };

  // Ops paste from browsers and chat clients; a bare "youtube.com/watch?v=..."
  // is a perfectly reasonable thing for a human to type.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: `not a URL: "${truncate(trimmed)}"` };
  }

  const host = url.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) return parseYouTube(url, host);
  if (TIKTOK_HOSTS.has(host)) return parseTikTok(url, host);

  return { ok: false, reason: `unsupported site "${host}" -- only YouTube and TikTok links are tracked` };
}

function parseYouTube(url: URL, host: string): ParsedUrl {
  // youtu.be/VIDEOID
  if (host.endsWith('youtu.be')) {
    return checkYouTubeId(firstPathSegment(url), url);
  }

  // youtube.com/watch?v=VIDEOID
  const v = url.searchParams.get('v');
  if (v) return checkYouTubeId(v, url);

  // youtube.com/shorts/VIDEOID, /embed/VIDEOID, /live/VIDEOID
  const segments = url.pathname.split('/').filter(Boolean);
  const [prefix, id] = segments;
  if (id && prefix && ['shorts', 'embed', 'live', 'v'].includes(prefix)) {
    return checkYouTubeId(id, url);
  }

  return { ok: false, reason: `YouTube link has no video id: ${truncate(url.href)}` };
}

function checkYouTubeId(candidate: string | null, url: URL): ParsedUrl {
  if (!candidate) return { ok: false, reason: `YouTube link has no video id: ${truncate(url.href)}` };
  if (!YOUTUBE_ID.test(candidate)) {
    return { ok: false, reason: `"${truncate(candidate)}" is not a valid YouTube video id` };
  }
  return { ok: true, platform: 'youtube', videoId: candidate };
}

function parseTikTok(url: URL, host: string): ParsedUrl {
  // Full form: tiktok.com/@creator/video/1234567890123456789
  const match = url.pathname.match(/\/video\/(\d+)/);
  if (match?.[1]) return { ok: true, platform: 'tiktok', videoId: match[1] };

  // Short form: vm.tiktok.com/ZMxxxxxx/ -- resolving these needs a redirect
  // fetch. We accept the share code as the id because TikTok is not ingested
  // yet (see sources/tiktok.ts); when it is, short links must be resolved
  // first, or the same video will be tracked twice under two ids.
  if (host.startsWith('vm.') || host.startsWith('vt.')) {
    const code = firstPathSegment(url);
    if (code) return { ok: true, platform: 'tiktok', videoId: code };
  }

  return { ok: false, reason: `TikTok link has no video id: ${truncate(url.href)}` };
}

function firstPathSegment(url: URL): string | null {
  return url.pathname.split('/').filter(Boolean)[0] ?? null;
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
