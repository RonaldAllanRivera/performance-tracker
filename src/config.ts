import 'dotenv/config';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Configuration and the run mode.
 *
 * Two rules here:
 *  1. Fail fast, and name every missing variable at once. Discovering missing
 *     config one variable per run is a miserable way to set this up.
 *  2. Dry-run mode must need *zero* credentials, so a new maintainer (or a
 *     reviewer) can see the whole pipeline work before requesting any keys.
 */

/**
 * Every date in this system is a YYYY-MM-DD string in this timezone.
 *
 * This matters more than it looks. GitHub Actions runs in UTC, so a job that
 * fires at 01:00 UTC is "yesterday" by UTC reckoning and "today" in Manila.
 * Deriving dates from the runner's clock would silently produce two snapshots
 * for one calendar day, or none. One timezone, resolved here, used everywhere.
 *
 * Set TIMEZONE in .env to any IANA zone name (e.g. Europe/Berlin) if the team
 * moves. Note this controls which calendar day a run is *recorded against*, not
 * what time the run fires -- GitHub parses the cron schedule before any
 * environment exists, so the firing time lives in .github/workflows/daily.yml
 * and has to be edited there. The two are documented together in that file.
 */
const DEFAULT_TIMEZONE = 'Asia/Manila';

export const TIMEZONE = resolveTimezone(process.env.TIMEZONE);

function resolveTimezone(raw: string | undefined): string {
  const timezone = raw?.trim() || DEFAULT_TIMEZONE;
  try {
    // Intl throws RangeError on an unknown zone. Better to find out at startup
    // than to silently record every snapshot against the wrong day.
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  } catch {
    throw new Error(
      `TIMEZONE="${timezone}" is not a valid IANA timezone name.\n` +
        `  Use a full zone name such as Asia/Manila, Europe/Berlin, or America/New_York.\n` +
        `  Abbreviations like PHT or EST are not valid here.`,
    );
  }
  return timezone;
}

/** The configured timezone's current UTC offset in hours, for logging. */
export function utcOffsetHours(timezone: string = TIMEZONE, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = parts?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, sign, hours = '0', minutes = '0'] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) + Number(minutes) / 60);
}

/** Local wall-clock time in the configured zone, for logging. */
export function localTime(timezone: string = TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

export interface Config {
  dryRun: boolean;
  timezone: string;
  sheetId: string;
  /**
   * Path to the service-account key file. Preferred locally: it removes any
   * need to move a 3,000-character credential through a terminal, which is a
   * reliable way to truncate it. Null in CI, where there is no file.
   */
  googleServiceAccountFile: string | null;
  /** The key inline, as JSON or base64. Used when no file path is given. */
  googleServiceAccountJson: string;
  youtubeApiKey: string;
  mongoUri: string;
  mongoDb: string;
  discordWebhookUrl: string;
  /** Optional: without it the digest uses the template writer, which is fine. */
  openaiApiKey: string | null;
  openaiModel: string;
}

const DRY_RUN = process.argv.includes('--dry-run');

function required(name: string, missing: string[]): string {
  const value = process.env[name]?.trim();
  if (!value) {
    missing.push(name);
    return '';
  }
  return value;
}

export function loadConfig(): Config {
  // Dry-run talks to nothing, so it needs nothing. This is the mode that makes
  // `npm i && npm run job:dry` work on a fresh clone.
  if (DRY_RUN) {
    return {
      dryRun: true,
      timezone: TIMEZONE,
      sheetId: '(dry-run)',
      googleServiceAccountFile: null,
      googleServiceAccountJson: '(dry-run)',
      youtubeApiKey: '(dry-run)',
      mongoUri: '(dry-run)',
      mongoDb: 'campaign_tracker',
      discordWebhookUrl: '(dry-run)',
      openaiApiKey: process.env.OPENAI_API_KEY?.trim() || null,
      openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    };
  }

  const missing: string[] = [];

  // Either form is fine, but one of them has to be there. A file path is the
  // easier option locally; CI has no file, so it sets the inline variable.
  const serviceAccountFile = expandHome(process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? '';
  if (!serviceAccountFile && !serviceAccountJson) {
    missing.push('GOOGLE_SERVICE_ACCOUNT_FILE (or GOOGLE_SERVICE_ACCOUNT_JSON)');
  }

  const config: Config = {
    dryRun: false,
    timezone: TIMEZONE,
    sheetId: required('SHEET_ID', missing),
    googleServiceAccountFile: serviceAccountFile,
    googleServiceAccountJson: serviceAccountJson,
    youtubeApiKey: required('YOUTUBE_API_KEY', missing),
    mongoUri: required('MONGO_URI', missing),
    mongoDb: process.env.MONGO_DB?.trim() || 'campaign_tracker',
    discordWebhookUrl: required('DISCORD_WEBHOOK_URL', missing),
    // Deliberately optional. A missing key degrades the prose, not the pipeline.
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() || null,
    openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  };

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}\n` +
        `  Copy .env.example to .env and fill these in -- the README says where each one comes from.\n` +
        `  To see the pipeline run with no credentials at all: npm run job:dry`,
    );
  }

  return config;
}

/**
 * Expand a leading `~` and make the path absolute.
 *
 * dotenv does no shell expansion, so `~/Downloads/key.json` in a .env arrives
 * as a literal tilde and fails to open with a confusing ENOENT.
 */
function expandHome(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const expanded = value.startsWith('~/') ? value.replace('~', homedir()) : value;
  return resolve(expanded);
}

/**
 * Today's date as YYYY-MM-DD in the configured timezone.
 *
 * `en-CA` is the shortest way to get ISO-ordered date parts out of Intl
 * without pulling in a date library.
 */
export function today(now: Date = new Date(), timezone: string = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
