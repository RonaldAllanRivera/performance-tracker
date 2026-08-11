import { JWT } from 'google-auth-library';
import type { Config } from '../config.js';
import { logger } from '../log.js';
import type { TrackedVideo, Warning } from '../types.js';
import { parseVideoUrl } from './urls.js';

/**
 * The tracking sheet is the input surface.
 *
 * WHY A SHEET AND NOT A UI: ops already lives in Google Sheets. A bespoke
 * internal tool is one more thing to log into, and internal tools nobody logs
 * into quietly rot. The tradeoff is that we get no input validation at entry
 * time -- so validation happens here, and every rejection is reported back in
 * the Discord digest, which is a place ops already reads.
 *
 * THE SHEET IS READ-ONLY TO THIS JOB. We never write back. If the job wrote to
 * the sheet, a write and a human edit could land at the same time and the human
 * would silently lose their row. The sheet is the source of truth for *what to
 * track*; Mongo is the source of truth for *history*. Those never overlap.
 */

const log = logger('sheet');

/** Columns: A video_url | B campaign | C creator | D added_by | E notes */
const RANGE = 'Tracked!A2:E';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export interface TrackedVideoSet {
  videos: TrackedVideo[];
  warnings: Warning[];
}

interface SheetsValuesResponse {
  values?: string[][];
}

/**
 * Turn raw sheet rows into tracked videos, collecting a warning for everything
 * we could not use.
 *
 * Pure, so the dry-run fixture path exercises exactly this logic rather than
 * bypassing it. If validation is broken, `npm run job:dry` shows it.
 */
export function parseRows(rows: string[][]): TrackedVideoSet {
  const videos: TrackedVideo[] = [];
  const warnings: Warning[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    // Data starts at sheet row 2, and rows[] is 0-based.
    const rowNumber = index + 2;
    const [url = '', campaign = '', creator = '', addedBy = ''] = row.map((cell) => (cell ?? '').trim());

    // Blank rows are normal -- people leave gaps and Sheets pads ranges.
    if (!url && !campaign && !creator) return;

    if (!url) {
      warnings.push({ kind: 'invalid_row', message: `Row ${rowNumber}: no video URL` });
      return;
    }

    const parsed = parseVideoUrl(url);
    if (!parsed.ok) {
      warnings.push({ kind: 'invalid_row', message: `Row ${rowNumber}: ${parsed.reason}` });
      return;
    }

    const key = `${parsed.platform}:${parsed.videoId}`;
    const firstSeenAt = seen.get(key);
    if (firstSeenAt !== undefined) {
      warnings.push({
        kind: 'duplicate',
        message: `Row ${rowNumber}: duplicate of row ${firstSeenAt}, ignored`,
      });
      return;
    }
    seen.set(key, rowNumber);

    videos.push({
      videoId: parsed.videoId,
      platform: parsed.platform,
      url,
      // Missing campaign/creator is untidy but not a reason to drop a row.
      campaign: campaign || '(no campaign)',
      creator: creator || '(unknown creator)',
      addedBy,
      row: rowNumber,
    });
  });

  return { videos, warnings };
}

/** Fetch and parse the tracking sheet. */
export async function readTrackedVideos(config: Config): Promise<TrackedVideoSet> {
  const client = buildClient(config.googleServiceAccountJson);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}` +
    `/values/${encodeURIComponent(RANGE)}?majorDimension=ROWS`;

  log.info(`reading ${RANGE} from sheet ${config.sheetId}`);
  const response = await client.request<SheetsValuesResponse>({ url });
  const rows = response.data.values ?? [];

  const result = parseRows(rows);
  log.info(`${rows.length} row(s) read, ${result.videos.length} tracked, ${result.warnings.length} warning(s)`);
  return result;
}

/**
 * Build an authenticated client from a service-account key.
 *
 * SETUP FOOTGUN, DOCUMENTED HERE BECAUSE IT WILL COST YOU AN HOUR OTHERWISE:
 * the downloaded key is pretty-printed JSON with real newlines inside
 * `private_key`. It cannot go into a .env file as-is. Either minify it
 * (`jq -c . key.json`) or base64 it (`base64 -w0 key.json`) -- both are
 * accepted below. Splitting the key into separate env vars is the version
 * that breaks, because the PEM newlines get mangled on the way through.
 */
function buildClient(rawCredentials: string): JWT {
  const trimmed = rawCredentials.trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Provide the whole service-account key file, ' +
        'either minified onto one line (`jq -c . key.json`) or base64-encoded (`base64 -w0 key.json`).',
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  }

  return new JWT({
    email: parsed.client_email,
    // Belt and braces: if the key arrives with literal backslash-n sequences
    // (a very common way to mangle it), turn them back into real newlines.
    key: parsed.private_key.replace(/\\n/g, '\n'),
    scopes: [SHEETS_SCOPE],
  });
}
