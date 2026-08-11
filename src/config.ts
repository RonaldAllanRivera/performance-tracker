import 'dotenv/config';

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
 * for one calendar day, or none. One timezone, declared here, used everywhere.
 */
export const TIMEZONE = 'Asia/Manila';

export interface Config {
  dryRun: boolean;
  timezone: string;
  sheetId: string;
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
  const config: Config = {
    dryRun: false,
    timezone: TIMEZONE,
    sheetId: required('SHEET_ID', missing),
    googleServiceAccountJson: required('GOOGLE_SERVICE_ACCOUNT_JSON', missing),
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
