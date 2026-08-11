import type { Config } from './config.js';
import { formatCount, formatDelta, formatPct, pluralise, truncate } from './format.js';
import { logger } from './log.js';
import type { Analysis, DigestedReport, Report } from './types.js';

/**
 * Turns a finished Report into a few sentences a non-technical teammate can
 * read at 9am without decoding anything.
 *
 * THE DESIGN RULE, AND THE ONLY ONE THAT MATTERS HERE:
 *
 *   The model never touches a number.
 *
 * Every figure, comparison, and anomaly decision is computed in analyze.ts,
 * deterministically, and unit-tested. The model receives an object that is
 * already correct and its only job is to phrase it. That is why the fallback
 * below is honest rather than embarrassing: the template renders the same
 * facts from the same object, so a model outage costs us fluency, not accuracy.
 *
 * It also means the failure mode this design does NOT protect against is the
 * model describing correct numbers wrongly. See the README self-review.
 */

const log = logger('digest');

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
  'You write a short daily performance update for a marketing operations team at a creator agency.',
  'Your readers are smart but non-technical: campaign managers, not engineers.',
  '',
  'Rules:',
  '- 3 to 5 sentences. No headings, no bullet points, no markdown, no emoji.',
  '- Use ONLY the numbers in the JSON you are given. Never calculate, estimate, or infer a figure that is not present.',
  '- Order: anything flagged first, then the biggest movers, then the overall total.',
  '- If nothing is flagged, say so plainly in the first sentence and keep the whole thing to two or three sentences.',
  '- Refer to videos by title. Do not mention video IDs, URLs, field names, or JSON.',
  '- Plain declarative English. No hype, no "exciting news", no recommendations unless the data states one.',
].join('\n');

export async function writeDigest(report: Report, config: Config): Promise<DigestedReport> {
  const template = renderTemplateDigest(report);

  if (!config.openaiApiKey) {
    log.info('no OPENAI_API_KEY set, using the template writer');
    return { ...report, digest: template, digestSource: 'template' };
  }

  try {
    const text = await callModel(report, config);
    log.info(`model digest written (${text.length} chars)`);
    return { ...report, digest: text, digestSource: 'llm' };
  } catch (error) {
    // Never fatal. A digest that reads a bit flatter is infinitely better than
    // no morning report, and the numbers are identical either way.
    log.warn('model call failed, falling back to the template:', describe(error));
    return { ...report, digest: template, digestSource: 'template' };
  }
}

async function callModel(report: Report, config: Config): Promise<string> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      // Deterministic: the same numbers should produce the same sentence.
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(buildFacts(report), null, 2) },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.error?.message ?? response.statusText}`);
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('model returned an empty completion');
  return text;
}

/**
 * The model gets a deliberately narrow view: pre-formatted figures, no URLs,
 * no ids, no internal field names. Less surface to misread, and a smaller
 * prompt costs less. At one run a day this is fractions of a cent a month.
 */
function buildFacts(report: Report) {
  const describeVideo = (a: Analysis) => ({
    title: a.title ?? '(untitled video)',
    campaign: a.campaign,
    creator: a.creator,
    views: a.views,
    viewsGained: a.deltas?.views ?? null,
    percentChange: a.pctViews === null ? null : formatPct(a.pctViews),
    note: describeFlags(a),
  });

  return {
    date: report.date,
    videosTracked: report.totals.videosTracked,
    totalViews: report.totals.totalViews,
    totalViewsGainedToday: report.totals.totalViewsDelta,
    flagged: report.flagged.map(describeVideo),
    topMovers: report.topMovers.map(describeVideo),
    dataIssues: report.warnings.map((w) => w.message),
  };
}

function describeFlags(a: Analysis): string | null {
  const notes: string[] = [];
  if (a.flags.includes('spike')) notes.push('grew unusually fast today');
  if (a.flags.includes('stalled')) notes.push('was growing and has now stopped');
  if (a.flags.includes('unavailable')) notes.push('is no longer viewable (deleted or set to private)');
  if (a.flags.includes('stats_hidden')) notes.push('has its view count hidden by the creator');
  return notes.length > 0 ? notes.join('; ') : null;
}

/**
 * The fallback writer. Also what you see in `--dry-run`, and what runs when no
 * OPENAI_API_KEY is set -- so it is exercised constantly rather than being
 * dead code that rots until the day it is needed.
 */
export function renderTemplateDigest(report: Report): string {
  const { totals, flagged, topMovers } = report;

  if (totals.videosTracked === 0) {
    return 'No videos are being tracked yet. Add creator video links to the tracking sheet and they will appear in tomorrow’s report.';
  }

  const sentences: string[] = [];

  sentences.push(
    `Tracking ${pluralise(totals.videosTracked, 'video')} with ${formatCount(totals.totalViews)} total views, ` +
      `${formatDelta(totals.totalViewsDelta)} since the last check.`,
  );

  if (flagged.length === 0) {
    sentences.push('Nothing needs attention today — everything is moving as expected.');
  } else {
    const details = flagged
      .slice(0, 5)
      .map((a) => `“${truncate(a.title ?? '(untitled video)', 50)}” ${describeFlags(a) ?? 'needs a look'}`)
      .join('; ');
    sentences.push(`${pluralise(flagged.length, 'video')} ${flagged.length === 1 ? 'needs' : 'need'} attention: ${details}.`);
  }

  if (topMovers.length > 0) {
    const movers = topMovers
      .map((a) => `“${truncate(a.title ?? '(untitled video)', 40)}” ${formatDelta(a.deltas?.views ?? 0)} views`)
      .join(', ');
    sentences.push(`Biggest gainers: ${movers}.`);
  }

  if (report.warnings.length > 0) {
    sentences.push(
      `${pluralise(report.warnings.length, 'item')} in the tracking sheet ${report.warnings.length === 1 ? 'needs' : 'need'} fixing — see the warnings below.`,
    );
  }

  return sentences.join(' ');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
