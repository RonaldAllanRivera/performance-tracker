/**
 * Number formatting shared by the digest writer and the Discord embed, so the
 * same figure never appears two ways in one message.
 */

export function formatCount(value: number | null): string {
  return value === null ? 'n/a' : value.toLocaleString('en-US');
}

export function formatDelta(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toLocaleString('en-US')}`;
}

/** 0.0392 -> "+3.9%". Null percentages are genuinely unknowable, not zero. */
export function formatPct(value: number | null): string {
  if (value === null) return 'n/a';
  const pct = value * 100;
  // Sub-1% movement rounds to "0.0%", which reads as a bug. Say what we mean.
  if (Math.abs(pct) < 0.05 && pct !== 0) return value > 0 ? '<+0.1%' : '>-0.1%';
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Titles come from the platform and can be long enough to break an embed. */
export function truncate(value: string, max = 70): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}
