import { readFileSync } from 'node:fs';
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
/** Column A. The only column where a cell's hyperlink beats its text. */
const URL_COLUMN = 0;
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export interface TrackedVideoSet {
  videos: TrackedVideo[];
  warnings: Warning[];
}

interface GridCell {
  formattedValue?: string;
  /** Set when the cell is a link. Google Sheets turns a pasted URL into a
   *  "smart chip" whose visible text is the page title, so this is often the
   *  only place the actual URL survives. */
  hyperlink?: string;
}

interface GridResponse {
  sheets?: Array<{ data?: Array<{ rowData?: Array<{ values?: GridCell[] }> }> }>;
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

/**
 * Flatten one grid row to plain strings, preferring a cell's hyperlink over its
 * visible text in the URL column.
 *
 * WHY THIS EXISTS. Paste a YouTube link into Sheets and Google may silently
 * convert it to a smart chip: the cell then *displays* the video's title and
 * keeps the URL only as link metadata. The plain values API returns the title,
 * so the row reads as "not a URL" and the video stops being tracked -- while
 * looking completely fine to the person who pasted it. Observed on a real
 * sheet: four rows dropped out overnight with nobody having edited them.
 *
 * The link is authoritative when present. Ops should not have to know that
 * Ctrl+Shift+V behaves differently from Ctrl+V.
 */
export function flattenRow(cells: GridCell[]): string[] {
  return cells.map((cell, column) =>
    column === URL_COLUMN && cell.hyperlink ? cell.hyperlink : (cell.formattedValue ?? ''),
  );
}

/** Fetch and parse the tracking sheet. */
export async function readTrackedVideos(config: Config): Promise<TrackedVideoSet> {
  const client = buildClient(config);
  // Grid data rather than plain values: we need each cell's hyperlink, which
  // the values endpoint does not return. Still a single request.
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.sheetId)}` +
    `?ranges=${encodeURIComponent(RANGE)}&includeGridData=true` +
    `&fields=${encodeURIComponent('sheets.data.rowData.values(formattedValue,hyperlink)')}`;

  // Truncated deliberately. This repo is public, so GitHub Actions logs are
  // public too. GitHub does redact registered secrets from logs, but that
  // relies on an exact string match -- it misses encoded or partial forms.
  // Six characters is enough to tell two sheets apart and useless to anyone else.
  log.info(`reading ${RANGE} from sheet ${config.sheetId.slice(0, 6)}…`);
  const response = await client.request<GridResponse>({ url });
  const rowData = response.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
  const rows = rowData.map((row) => flattenRow(row.values ?? []));

  const result = parseRows(rows);
  log.info(`${rows.length} row(s) read, ${result.videos.length} tracked, ${result.warnings.length} warning(s)`);
  return result;
}

/**
 * Get the raw key, from a file if one is configured.
 *
 * PREFER THE FILE LOCALLY. The inline form requires moving a ~3,200-character
 * credential through a terminal, and a copy that stops one character early
 * produces a key that is structurally perfect right up to the point where it
 * fails. I truncated it three times before adding this. CI still uses the
 * inline variable, because a runner has no file to point at.
 */
function readCredentials(config: Config): string {
  if (!config.googleServiceAccountFile) return config.googleServiceAccountJson;
  try {
    return readFileSync(config.googleServiceAccountFile, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read GOOGLE_SERVICE_ACCOUNT_FILE at ${config.googleServiceAccountFile}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Build an authenticated client from a service-account key.
 *
 * Accepts raw JSON or base64: the downloaded file is pretty-printed with real
 * newlines inside `private_key`, so it cannot go into a .env as-is. Splitting
 * the fields into separate env vars is the version that breaks, because the
 * PEM newlines get mangled on the way through.
 */
function buildClient(config: Config): JWT {
  const source = config.googleServiceAccountFile
    ? `GOOGLE_SERVICE_ACCOUNT_FILE (${config.googleServiceAccountFile})`
    : 'GOOGLE_SERVICE_ACCOUNT_JSON';
  const trimmed = readCredentials(config).trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');

  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error(
      `${source} did not contain valid JSON. Provide the whole service-account key file. ` +
        'The usual cause is a truncated copy: the value must be the complete file, so prefer ' +
        'GOOGLE_SERVICE_ACCOUNT_FILE pointing at the .json rather than pasting its contents.',
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`${source} is missing client_email or private_key.`);
  }

  return new JWT({
    email: parsed.client_email,
    // Belt and braces: if the key arrives with literal backslash-n sequences
    // (a very common way to mangle it), turn them back into real newlines.
    key: parsed.private_key.replace(/\\n/g, '\n'),
    scopes: [SHEETS_SCOPE],
  });
}
