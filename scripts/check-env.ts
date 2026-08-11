import { createPrivateKey, createPublicKey, createSign, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import 'dotenv/config';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * Preflight check for .env. Run it with `npm run check:env`.
 *
 * Exists because the service-account key is genuinely easy to get wrong: it is
 * ~3,200 characters, and a copy that stops one character early produces a value
 * that looks perfect and fails with an error that describes nothing. This
 * validates every credential's shape offline -- no network calls, no writes --
 * and NEVER prints a secret, so it is safe to run while screen-sharing.
 *
 * It deliberately does NOT stop at the first problem. A diagnostic that hides
 * nine results because the tenth is missing is not a diagnostic. Same reasoning
 * as the job itself: report everything, then decide.
 */

let failures = 0;
let warnings = 0;
const pass = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m: string) => { warnings++; console.log(`  \x1b[33m!\x1b[0m ${m}`); };
const fail = (m: string) => { failures++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const section = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

const env = (name: string): string => process.env[name]?.trim() ?? '';
const expandHome = (v: string) => (v.startsWith('~/') ? resolve(v.replace('~', homedir())) : v ? resolve(v) : '');

/** Report a variable as missing, but keep checking everything else. */
function present(name: string): boolean {
  if (env(name)) return true;
  fail(`${name} is empty`);
  return false;
}

// dotenv treats an unquoted `#` as the start of a comment and silently drops
// the rest of the line, so a value containing one arrives truncated and the
// resulting error describes something else entirely. Comparing the raw file
// against what was actually parsed is the only way to see this.
section('.env hygiene');
try {
  const rawFile = readFileSync('.env', 'utf8');
  let trouble = 0;
  for (const line of rawFile.split('\n')) {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const name = match[1] ?? '';
    const rawValue = (match[2] ?? '').trim();
    if (!rawValue || rawValue.startsWith('"') || rawValue.startsWith("'")) continue;
    if (rawValue.includes('#') && (process.env[name] ?? '').length < rawValue.length) {
      trouble++;
      fail(`${name} is cut short at a "#" — .env reads that as a comment. Wrap the value in double quotes, or regenerate it without a #`);
    }
  }
  if (trouble === 0) pass('no values truncated by .env comment syntax');
} catch {
  warn('no .env file found — reading configuration from the environment instead');
}

section('Schedule');
const timezone = env('TIMEZONE') || 'Asia/Manila';
try {
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date());
  pass(`TIMEZONE ${timezone} — local time now ${now}`);
} catch {
  fail(`TIMEZONE "${timezone}" is not a valid IANA zone name (use e.g. Asia/Manila)`);
}

section('Service-account key');
const keyFile = expandHome(env('GOOGLE_SERVICE_ACCOUNT_FILE'));
const keyInline = env('GOOGLE_SERVICE_ACCOUNT_JSON');
let rawKey = '';

if (!keyFile && !keyInline) {
  fail('neither GOOGLE_SERVICE_ACCOUNT_FILE nor GOOGLE_SERVICE_ACCOUNT_JSON is set');
} else {
  pass(keyFile ? `source is file: ${keyFile}` : 'source is inline GOOGLE_SERVICE_ACCOUNT_JSON');
  if (keyFile && keyInline) console.log('      (both set — the file wins)');
  try {
    rawKey = (keyFile ? readFileSync(keyFile, 'utf8') : keyInline).trim();
    pass(`read ${rawKey.length} characters`);
  } catch (error) {
    fail(`cannot read it: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// When a file is in use, also sanity-check the inline value, because that is
// the one that has to work in GitHub Actions.
if (keyFile && keyInline) {
  const ok = (() => {
    try { JSON.parse(keyInline.startsWith('{') ? keyInline : Buffer.from(keyInline, 'base64').toString('utf8')); return true; }
    catch { return false; }
  })();
  ok ? pass('inline GOOGLE_SERVICE_ACCOUNT_JSON is also valid (needed for GitHub Actions)')
     : warn('inline GOOGLE_SERVICE_ACCOUNT_JSON is invalid — fine locally, but GitHub Actions needs it');
}

if (rawKey) {
  const isJson = rawKey.startsWith('{');
  if (!isJson) {
    rawKey.length % 4 === 0
      ? pass('base64 length is a multiple of 4')
      : fail(`base64 length % 4 = ${rawKey.length % 4} — the value is TRUNCATED`);
    Buffer.from(Buffer.from(rawKey, 'base64').toString('utf8'), 'utf8').toString('base64') === rawKey
      ? pass('base64 round-trips exactly — nothing lost')
      : fail('base64 does not round-trip — the value is truncated or altered');
  }

  const text = isJson ? rawKey : Buffer.from(rawKey, 'base64').toString('utf8');
  let key: { client_email?: string; private_key?: string; project_id?: string; type?: string } = {};
  try {
    key = JSON.parse(text);
    pass('parses as JSON');
  } catch (error) {
    fail(`not valid JSON: ${error instanceof Error ? error.message : String(error)} — almost always a truncated copy`);
  }

  if (key.private_key) {
    key.type === 'service_account' ? pass('type is service_account') : fail(`type is "${key.type}"`);
    key.private_key.trimEnd().endsWith('-----END PRIVATE KEY-----')
      ? pass('PEM footer intact')
      : fail('PEM footer missing — truncated');
    try {
      const parsed = createPrivateKey(key.private_key);
      const signature = createSign('RSA-SHA256').update('preflight').sign(parsed);
      createVerify('RSA-SHA256').update('preflight').verify(createPublicKey(parsed), signature)
        ? pass(`signs and verifies (RSA ${parsed.asymmetricKeyDetails?.modulusLength}-bit) — this is what auth actually does`)
        : fail('key could not produce a valid signature');
    } catch (error) {
      fail(`key unusable: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log(`      account: ${key.client_email}`);
  }
}

section('Other credentials');
if (present('SHEET_ID')) {
  /^[\w-]{40,}$/.test(env('SHEET_ID')) ? pass(`SHEET_ID looks well-formed (${env('SHEET_ID').length} chars)`)
    : warn(`SHEET_ID is ${env('SHEET_ID').length} chars — sheet ids are usually 44`);
}

if (present('YOUTUBE_API_KEY')) {
  env('YOUTUBE_API_KEY').startsWith('AIza') ? pass('YOUTUBE_API_KEY has the expected AIza prefix')
    : warn('YOUTUBE_API_KEY does not start with "AIza" — check you copied an API key, not a client id');
}

if (present('MONGO_URI')) {
  const uri = env('MONGO_URI');
  if (/<|>/.test(uri)) {
    fail('MONGO_URI still contains <angle-brackets> — replace the placeholders and delete the brackets');
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    fail('MONGO_URI is not a mongodb:// or mongodb+srv:// connection string');
  } else {
    pass(`MONGO_URI is a ${uri.startsWith('mongodb+srv') ? 'mongodb+srv' : 'mongodb'} connection string`);

    // Split on the LAST '@'. Splitting on the first would read the password
    // "pa@ss" as "pa" and miss the very problem this check exists for.
    const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
    const at = afterScheme.lastIndexOf('@');
    const credentials = at >= 0 ? afterScheme.slice(0, at) : '';
    const host = at >= 0 ? afterScheme.slice(at + 1) : afterScheme;
    const colon = credentials.indexOf(':');
    const password = colon >= 0 ? credentials.slice(colon + 1) : '';

    if (!credentials) {
      warn('MONGO_URI has no username:password — Atlas clusters require them');
    } else if (/[@:/?#[\]]/.test(password)) {
      const offenders = [...new Set(password.match(/[@:/?#[\]]/g) ?? [])].join(' ');
      fail(`the password contains ${offenders} which must be URL-encoded — this surfaces as a confusing auth error. Regenerating an alphanumeric password is easier`);
    } else {
      pass('password needs no URL-encoding');
    }

    if (!host.split(/[/?]/)[0]?.includes('.')) fail('MONGO_URI has no hostname after the @');
  }
}

if (present('DISCORD_WEBHOOK_URL')) {
  /^https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(env('DISCORD_WEBHOOK_URL'))
    ? pass('DISCORD_WEBHOOK_URL is a well-formed webhook URL')
    : fail('DISCORD_WEBHOOK_URL is not shaped like https://discord.com/api/webhooks/<id>/<token>');
}

env('OPENAI_API_KEY')
  ? pass('OPENAI_API_KEY set — digest will be written by the model')
  : warn('OPENAI_API_KEY not set — digest falls back to the template (numbers are identical)');

console.log(
  failures === 0
    ? `\n\x1b[32m✓ Ready to run.\x1b[0m${warnings ? ` ${warnings} warning(s) above.` : ''} Next: npm run job\n`
    : `\n\x1b[31m✗ ${failures} problem(s) must be fixed before npm run job.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
