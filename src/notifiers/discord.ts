import { formatCount, formatDelta, formatPct, pluralise, truncate } from '../format.js';
import { logger } from '../log.js';
import type { Analysis, DigestedReport } from '../types.js';
import type { Notifier } from './types.js';

/**
 * Discord webhook delivery.
 *
 * The payload builder is pure and exported separately from the sending, so
 * `--dry-run` prints exactly what would have been posted rather than an
 * approximation of it. If the embed is malformed, a dry run shows it.
 */

const log = logger('discord');

const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const GREY = 0x95a5a6;

// Discord's documented limits. Exceeding any of them fails the whole message
// with a 400, so everything below is clamped rather than hoped about.
const MAX_FIELD_VALUE = 1024;
const MAX_DESCRIPTION = 4096;

export interface DiscordPayload {
  username: string;
  embeds: Array<{
    title: string;
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    footer: { text: string };
    timestamp: string;
  }>;
}

export function buildPayload(report: DigestedReport): DiscordPayload {
  const { totals, flagged, topMovers, warnings } = report;

  const previousTotal = totals.totalViews - totals.totalViewsDelta;
  const overallPct = previousTotal > 0 ? totals.totalViewsDelta / previousTotal : null;

  const fields: DiscordPayload['embeds'][number]['fields'] = [
    { name: 'Tracked', value: pluralise(totals.videosTracked, 'video'), inline: true },
    { name: 'Total views', value: formatCount(totals.totalViews), inline: true },
    {
      name: 'Change',
      value:
        overallPct === null
          ? formatDelta(totals.totalViewsDelta)
          : `${formatDelta(totals.totalViewsDelta)} (${formatPct(overallPct)})`,
      inline: true,
    },
  ];

  // Anomalies first: this is the only section anyone is obliged to read.
  if (flagged.length > 0) {
    fields.push({
      name: `⚠️ Needs attention (${flagged.length})`,
      value: clampList(flagged.map(describeFlagged)),
    });
  }

  // Campaigns sit between "what's broken" and "what moved": anomalies are the
  // only section anyone is obliged to read, but campaign totals are the thing
  // ops came for.
  if (report.campaigns.length > 0) {
    fields.push({
      name: '📊 By campaign',
      value: clampList(
        report.campaigns.map(
          (c) =>
            `• **${truncate(c.campaign, 40)}** — ${formatCount(c.views)} views, ` +
            `${formatDelta(c.viewsDelta)} (${pluralise(c.videos, 'video')})`,
        ),
      ),
    });
  }

  if (topMovers.length > 0) {
    fields.push({
      name: '📈 Top movers',
      value: clampList(
        topMovers.map(
          (a) =>
            `**${truncate(a.title ?? '(untitled)', 60)}** — ${formatDelta(a.deltas?.views ?? 0)} views` +
            `${a.pctViews === null ? '' : ` (${formatPct(a.pctViews)})`}`,
        ),
      ),
    });
  }

  // Warnings are deliberately in the same message as the good news. A separate
  // "errors" channel is a channel that gets muted.
  if (warnings.length > 0) {
    fields.push({
      name: `🔧 Needs fixing (${warnings.length})`,
      value: clampList(warnings.map((w) => `• ${w.message}`)),
    });
  }

  return {
    username: 'Campaign Tracker',
    embeds: [
      {
        title: `Campaign Video Report — ${report.date}`,
        description: truncateText(report.digest, MAX_DESCRIPTION),
        color: totals.videosTracked === 0 ? GREY : flagged.length > 0 ? RED : GREEN,
        fields,
        footer: {
          // Surfaces the fallback rate to humans without needing metrics: if
          // this reads "template" for a week, the model calls are failing and
          // nobody would otherwise notice, because the report still arrives.
          text:
            report.digestSource === 'llm'
              ? 'Summary written by AI from verified figures'
              : 'Summary written from a template (AI unavailable)',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function describeFlagged(a: Analysis): string {
  // Creator as well as title: ops think in creators, and a deleted video may
  // have no title at all beyond the one we cached.
  const title = `**${truncate(a.title ?? '(untitled)', 55)}** · ${a.creator}`;

  if (a.flags.includes('unavailable')) return `• ${title} — no longer viewable (deleted or private)`;
  if (a.flags.includes('stats_hidden')) return `• ${title} — view count hidden by the creator`;

  const movement = `${formatDelta(a.deltas?.views ?? 0)} views${a.pctViews === null ? '' : ` (${formatPct(a.pctViews)})`}`;
  if (a.flags.includes('spike')) return `• ${title} — spiking, ${movement}`;
  if (a.flags.includes('stalled')) return `• ${title} — growth has stopped, ${movement}`;
  return `• ${title} — ${movement}`;
}

/** Joins lines to fit a field, replacing the overflow with an honest count. */
function clampList(lines: string[]): string {
  const kept: string[] = [];
  let length = 0;

  for (const line of lines) {
    // +24 leaves room for the "...and N more" line we may need to append.
    if (length + line.length + 1 > MAX_FIELD_VALUE - 24) break;
    kept.push(line);
    length += line.length + 1;
  }

  const dropped = lines.length - kept.length;
  if (dropped > 0) kept.push(`_…and ${dropped} more_`);
  return kept.join('\n') || '—';
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function createDiscordNotifier(webhookUrl: string): Notifier {
  return {
    channel: 'discord',

    async send(report: DigestedReport): Promise<void> {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload(report)),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Discord webhook returned HTTP ${response.status}: ${truncate(body, 300)}`);
      }

      log.info('report posted');
    },
  };
}
