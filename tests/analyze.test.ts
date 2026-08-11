import { describe, expect, it } from 'vitest';
import { analyzeVideo, buildReport, daysBetween } from '../src/analyze.js';
import { RULES } from '../src/rules.js';
import type { Snapshot, TrackedVideo, VideoStats } from '../src/types.js';

/**
 * analyze.ts is the only module with tests, on purpose: it is the only place
 * that decides anything, and every other module is I/O that a test would have
 * to mock into meaninglessness. The cut is declared in the README.
 *
 * The cases that matter most here are the two that assert something does NOT
 * happen -- a small video is not a spike, and a stalled video does not re-alert.
 * Those are the rules that turn a useful digest into noise ops learns to ignore.
 */

const FETCHED_AT = new Date('2026-08-11T01:00:00.000Z');

function video(overrides: Partial<TrackedVideo> = {}): TrackedVideo {
  return {
    videoId: 'dQw4w9WgXcQ',
    platform: 'youtube',
    url: 'https://youtu.be/dQw4w9WgXcQ',
    campaign: 'Genshin Summer',
    creator: 'creator_one',
    addedBy: 'ops@contentlab',
    row: 2,
    ...overrides,
  };
}

function stats(overrides: Partial<VideoStats> = {}): VideoStats {
  return {
    videoId: 'dQw4w9WgXcQ',
    status: 'ok',
    title: 'Summer campaign spot',
    views: 1000,
    likes: 100,
    comments: 10,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    videoId: 'dQw4w9WgXcQ',
    platform: 'youtube',
    url: 'https://youtu.be/dQw4w9WgXcQ',
    campaign: 'Genshin Summer',
    creator: 'creator_one',
    date: '2026-08-10',
    title: 'Summer campaign spot',
    views: 900,
    likes: 90,
    comments: 9,
    pctViews: null,
    status: 'ok',
    fetchedAt: new Date('2026-08-10T01:00:00.000Z'),
    ...overrides,
  };
}

const TODAY = '2026-08-11';

describe('daysBetween', () => {
  it('counts calendar days and survives a month boundary', () => {
    expect(daysBetween('2026-08-10', '2026-08-11')).toBe(1);
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1);
    expect(daysBetween('2026-08-08', '2026-08-11')).toBe(3);
    expect(daysBetween('2026-08-11', '2026-08-11')).toBe(0);
  });
});

describe('first run', () => {
  it('records a baseline and flags nothing', () => {
    const { analysis, snapshot: written } = analyzeVideo(video(), stats(), null, TODAY, FETCHED_AT);

    expect(analysis.isBaseline).toBe(true);
    expect(analysis.flags).toEqual([]);
    expect(analysis.deltas).toBeNull();
    expect(analysis.pctViews).toBeNull();
    // Still persisted -- tomorrow needs something to compare against.
    expect(written.views).toBe(1000);
    expect(written.date).toBe(TODAY);
  });
});

describe('normal growth', () => {
  it('reports deltas without flagging anything', () => {
    const { analysis } = analyzeVideo(video(), stats({ views: 1000 }), snapshot({ views: 900 }), TODAY, FETCHED_AT);

    expect(analysis.deltas).toEqual({ views: 100, likes: 10, comments: 1 });
    expect(analysis.pctViews).toBeCloseTo(0.111, 3);
    expect(analysis.daysSincePrevious).toBe(1);
    expect(analysis.flags).toEqual([]);
  });

  it('handles a video that has not moved at all', () => {
    const { analysis } = analyzeVideo(video(), stats({ views: 900 }), snapshot({ views: 900 }), TODAY, FETCHED_AT);

    expect(analysis.deltas?.views).toBe(0);
    expect(analysis.pctViews).toBe(0);
    // Flat, but it was not growing yesterday either, so this is not news.
    expect(analysis.flags).toEqual([]);
  });

  it('does not blow up when a platform revises counts downward', () => {
    const { analysis } = analyzeVideo(video(), stats({ views: 850 }), snapshot({ views: 900 }), TODAY, FETCHED_AT);

    expect(analysis.deltas?.views).toBe(-50);
    expect(analysis.flags).toEqual([]);
  });
});

describe('spike detection', () => {
  it('flags a big jump that is also big in absolute terms', () => {
    const { analysis } = analyzeVideo(video(), stats({ views: 5000 }), snapshot({ views: 1000 }), TODAY, FETCHED_AT);

    expect(analysis.pctViews).toBe(4);
    expect(analysis.flags).toContain('spike');
  });

  it('does NOT flag a percentage spike on a tiny video', () => {
    // 4 -> 7 views is +75%, comfortably over SPIKE_PCT, and completely
    // meaningless. Without the absolute floor this alert fires constantly and
    // ops stops reading the digest. This is the regression test for that.
    const { analysis } = analyzeVideo(video(), stats({ views: 7 }), snapshot({ views: 4 }), TODAY, FETCHED_AT);

    expect(analysis.pctViews).toBeGreaterThan(RULES.SPIKE_PCT);
    expect(analysis.flags).not.toContain('spike');
  });

  it('does NOT flag a large absolute gain that is proportionally ordinary', () => {
    // +2,000 views on a million-view video is a rounding error, not a spike.
    const { analysis } = analyzeVideo(
      video(),
      stats({ views: 1_002_000 }),
      snapshot({ views: 1_000_000 }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.deltas?.views).toBe(2000);
    expect(analysis.flags).not.toContain('spike');
  });

  it('flags growth from zero, where there is no percentage to compute', () => {
    const { analysis } = analyzeVideo(video(), stats({ views: 500 }), snapshot({ views: 0 }), TODAY, FETCHED_AT);

    expect(analysis.pctViews).toBeNull();
    expect(analysis.flags).toContain('spike');
  });

  it('leaves a still-dead video alone', () => {
    const { analysis } = analyzeVideo(video(), stats({ views: 0 }), snapshot({ views: 0 }), TODAY, FETCHED_AT);

    expect(analysis.deltas?.views).toBe(0);
    expect(analysis.flags).toEqual([]);
  });
});

describe('stall detection', () => {
  it('flags the moment a growing video stops', () => {
    const { analysis } = analyzeVideo(
      video(),
      stats({ views: 10_050 }),
      // Yesterday it was growing at +20%/day.
      snapshot({ views: 10_000, pctViews: 0.2 }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.flags).toContain('stalled');
  });

  it('does NOT re-flag a video that was already stalled yesterday', () => {
    // The state-vs-transition bug. Nearly every video stalls permanently after
    // its first week; a state-based rule would alert on all of them, every
    // single morning, forever.
    const { analysis } = analyzeVideo(
      video(),
      stats({ views: 10_050 }),
      snapshot({ views: 10_000, pctViews: 0.002 }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.flags).not.toContain('stalled');
  });

  it('does not flag a stall on the day after a baseline', () => {
    // Yesterday was the first sighting, so pctViews is null and we have no
    // evidence it was ever growing.
    const { analysis } = analyzeVideo(
      video(),
      stats({ views: 10_050 }),
      snapshot({ views: 10_000, pctViews: null }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.flags).not.toContain('stalled');
  });
});

describe('missed runs', () => {
  it('reports the delta but withholds rate flags across a multi-day gap', () => {
    // Three days of ordinary growth looks exactly like a one-day spike.
    const { analysis } = analyzeVideo(
      video(),
      stats({ views: 5000 }),
      snapshot({ views: 1000, date: '2026-08-08', pctViews: 0.2 }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.daysSincePrevious).toBe(3);
    expect(analysis.deltas?.views).toBe(4000);
    expect(analysis.flags).toEqual([]);
  });
});

describe('unusable stats', () => {
  it('flags a deleted or private video and stores the fact', () => {
    const gone = stats({ status: 'unavailable', title: null, views: null, likes: null, comments: null });
    const { analysis, snapshot: written } = analyzeVideo(video(), gone, snapshot(), TODAY, FETCHED_AT);

    expect(analysis.flags).toEqual(['unavailable']);
    expect(analysis.deltas).toBeNull();
    expect(written.status).toBe('unavailable');
    expect(written.views).toBeNull();
  });

  it('flags hidden statistics without producing NaN anywhere', () => {
    // YouTube omits viewCount entirely when the owner hides it. The naive
    // version of this code does Number(undefined) and quietly poisons every
    // downstream total with NaN.
    const hidden = stats({ status: 'stats_hidden', views: null, likes: null, comments: null });
    const { analysis, snapshot: written } = analyzeVideo(video(), hidden, snapshot(), TODAY, FETCHED_AT);

    expect(analysis.flags).toEqual(['stats_hidden']);
    expect(analysis.deltas).toBeNull();
    expect(analysis.pctViews).toBeNull();
    expect(Number.isNaN(written.views as number)).toBe(false);
  });

  it('treats a video that comes back after being unavailable as a fresh baseline', () => {
    const { analysis } = analyzeVideo(
      video(),
      stats({ views: 1200 }),
      snapshot({ status: 'unavailable', views: null, pctViews: null }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.deltas).toBeNull();
    expect(analysis.flags).toEqual([]);
  });
});

describe('buildReport', () => {
  it('totals views, ranks movers, and ignores unusable rows in the maths', () => {
    const analyses = [
      analyzeVideo(video({ videoId: 'a' }), stats({ videoId: 'a', views: 5000 }), snapshot({ videoId: 'a', views: 1000 }), TODAY, FETCHED_AT).analysis,
      // A genuine mover, but a proportionally ordinary one: it belongs in
      // "top movers" and must NOT appear in "anomalies". Those are different
      // questions and the digest asks both.
      analyzeVideo(video({ videoId: 'b' }), stats({ videoId: 'b', views: 1050 }), snapshot({ videoId: 'b', views: 1000 }), TODAY, FETCHED_AT).analysis,
      analyzeVideo(video({ videoId: 'c' }), stats({ videoId: 'c', status: 'unavailable', views: null, likes: null, comments: null }), snapshot({ videoId: 'c' }), TODAY, FETCHED_AT).analysis,
    ];

    const report = buildReport(TODAY, analyses, [{ kind: 'invalid_row', message: 'Row 9: not a URL' }]);

    expect(report.totals.videosTracked).toBe(3);
    expect(report.totals.totalViews).toBe(6050); // the unavailable video contributes nothing
    expect(report.totals.totalViewsDelta).toBe(4050);
    expect(report.topMovers.map((m) => m.videoId)).toEqual(['a', 'b']);
    // 'b' moved the second most and is still not an anomaly.
    expect(report.flagged.map((f) => f.videoId)).toEqual(['a', 'c']);
    expect(report.warnings).toHaveLength(1);
  });

  it('produces a coherent empty report when nothing is tracked', () => {
    const report = buildReport(TODAY, [], []);

    expect(report.totals).toEqual({ videosTracked: 0, totalViews: 0, totalViewsDelta: 0 });
    expect(report.topMovers).toEqual([]);
    expect(report.flagged).toEqual([]);
  });
});

describe('identifying a video after it disappears', () => {
  it('carries the last known title forward when the API stops returning one', () => {
    // The one case where the title matters most -- "which video died?" -- is
    // the one case the API gives us nothing to answer it with.
    const gone = stats({ status: 'unavailable', title: null, views: null, likes: null, comments: null });
    const { analysis, snapshot: written } = analyzeVideo(
      video(),
      gone,
      snapshot({ title: 'Genshin 5.0 co-op night with the squad' }),
      TODAY,
      FETCHED_AT,
    );

    expect(analysis.title).toBe('Genshin 5.0 co-op night with the squad');
    // Persisted too, so the title survives however many days it stays dead.
    expect(written.title).toBe('Genshin 5.0 co-op night with the squad');
  });
});
