import { describe, expect, it } from 'vitest';
import { InMemoryStore } from '../src/storage.js';
import type { Snapshot } from '../src/types.js';

/**
 * These tests pin the Store *contract* -- the behaviour job.ts relies on --
 * against the in-memory implementation.
 *
 * HONEST SCOPE NOTE: this does not exercise MongoStore. Mongo's idempotency
 * rests on the unique index on (videoId, date) created in init(), and verifying
 * that needs a real mongod. Doing it properly means mongodb-memory-server,
 * which downloads a binary and roughly doubles install time for a prototype.
 * The manual check is in the README: run `npm run job` twice in one day and
 * confirm the collection count does not change.
 */

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    videoId: 'gv3Qx7mNp0A',
    platform: 'youtube',
    url: 'https://youtu.be/gv3Qx7mNp0A',
    campaign: 'Govee Q3 Launch',
    creator: 'maya.reyes',
    date: '2026-08-11',
    title: 'Govee RGB strip',
    views: 1000,
    likes: 10,
    comments: 1,
    pctViews: null,
    status: 'ok',
    fetchedAt: new Date('2026-08-11T01:00:00.000Z'),
    ...overrides,
  };
}

describe('snapshot store contract', () => {
  it('upserts rather than appends when the job re-runs on the same day', async () => {
    const store = new InMemoryStore();
    await store.upsertSnapshot(snapshot({ views: 1000 }));
    await store.upsertSnapshot(snapshot({ views: 1400 }));

    // Tomorrow must see one row for today, carrying the *latest* numbers.
    const previous = await store.getPreviousSnapshot('gv3Qx7mNp0A', '2026-08-12');
    expect(previous?.views).toBe(1400);
    expect(previous?.date).toBe('2026-08-11');
  });

  it('returns the most recent snapshot strictly before the given date', async () => {
    const store = new InMemoryStore([
      snapshot({ date: '2026-08-08', views: 100 }),
      snapshot({ date: '2026-08-10', views: 300 }),
      // Today's own row must never be treated as its own predecessor.
      snapshot({ date: '2026-08-11', views: 400 }),
    ]);

    const previous = await store.getPreviousSnapshot('gv3Qx7mNp0A', '2026-08-11');
    expect(previous?.date).toBe('2026-08-10');
    expect(previous?.views).toBe(300);
  });

  it('returns null on a video it has never seen', async () => {
    const store = new InMemoryStore([snapshot()]);
    expect(await store.getPreviousSnapshot('unknown-id', '2026-08-11')).toBeNull();
  });

  it('keeps different videos independent', async () => {
    const store = new InMemoryStore([
      snapshot({ videoId: 'aaa', date: '2026-08-10', views: 1 }),
      snapshot({ videoId: 'bbb', date: '2026-08-10', views: 2 }),
    ]);

    expect((await store.getPreviousSnapshot('aaa', '2026-08-11'))?.views).toBe(1);
    expect((await store.getPreviousSnapshot('bbb', '2026-08-11'))?.views).toBe(2);
  });
});
