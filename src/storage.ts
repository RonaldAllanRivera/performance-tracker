import { MongoClient, type Collection, type Db } from 'mongodb';
import type { Config } from './config.js';
import { logger } from './log.js';
import type { Snapshot } from './types.js';

/**
 * Snapshot history.
 *
 * One collection. The sheet already holds the list of what to track, so there
 * is no `videos` collection to keep in sync with it -- campaign and creator are
 * denormalised onto each snapshot instead. Two sources of truth for the same
 * list is a bug waiting to happen, and this is the version with one.
 *
 * DATES ARE YYYY-MM-DD STRINGS, NOT Date OBJECTS. That is deliberate: string
 * comparison on this format is chronological comparison, so `date: { $lt: x }`
 * with a descending sort finds the previous snapshot with no timezone maths and
 * no ambiguity about what "the same day" means across a UTC runner and a Manila
 * business day. See config.ts.
 */

const log = logger('mongo');
const COLLECTION = 'snapshots';

export interface Store {
  init(): Promise<void>;
  /** Most recent snapshot strictly before `beforeDate`, or null on first sighting. */
  getPreviousSnapshot(videoId: string, beforeDate: string): Promise<Snapshot | null>;
  upsertSnapshot(snapshot: Snapshot): Promise<void>;
  close(): Promise<void>;
}

export class MongoStore implements Store {
  private client: MongoClient;
  private db: Db;

  constructor(uri: string, dbName: string) {
    this.client = new MongoClient(uri);
    this.db = this.client.db(dbName);
  }

  private get snapshots(): Collection<Snapshot> {
    return this.db.collection<Snapshot>(COLLECTION);
  }

  async init(): Promise<void> {
    await this.client.connect();

    // The idempotency guarantee, enforced by the database rather than by the
    // application remembering to be careful. Re-running the job on the same day
    // updates the row; it cannot create a second one.
    await this.snapshots.createIndex({ videoId: 1, date: -1 }, { unique: true, name: 'videoId_date_unique' });
    log.info('connected, indexes ensured');
  }

  async getPreviousSnapshot(videoId: string, beforeDate: string): Promise<Snapshot | null> {
    return this.snapshots.findOne(
      { videoId, date: { $lt: beforeDate } },
      { sort: { date: -1 }, projection: { _id: 0 } },
    );
  }

  async upsertSnapshot(snapshot: Snapshot): Promise<void> {
    await this.snapshots.updateOne(
      { videoId: snapshot.videoId, date: snapshot.date },
      { $set: snapshot },
      { upsert: true },
    );
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Non-persistent store for `--dry-run`. Lets the whole pipeline run end to end
 * with no database, so a new maintainer can see it work before asking anyone
 * for an Atlas connection string.
 */
export class InMemoryStore implements Store {
  private rows = new Map<string, Snapshot>();

  constructor(seed: Snapshot[] = []) {
    for (const snapshot of seed) this.rows.set(key(snapshot.videoId, snapshot.date), snapshot);
  }

  async init(): Promise<void> {
    log.info(`in-memory store ready (${this.rows.size} seeded snapshot(s))`);
  }

  async getPreviousSnapshot(videoId: string, beforeDate: string): Promise<Snapshot | null> {
    const candidates = [...this.rows.values()]
      .filter((s) => s.videoId === videoId && s.date < beforeDate)
      .sort((a, b) => b.date.localeCompare(a.date));
    return candidates[0] ?? null;
  }

  async upsertSnapshot(snapshot: Snapshot): Promise<void> {
    this.rows.set(key(snapshot.videoId, snapshot.date), snapshot);
  }

  async close(): Promise<void> {}
}

function key(videoId: string, date: string): string {
  return `${videoId}:${date}`;
}

export function createStore(config: Config, seed: Snapshot[] = []): Store {
  return config.dryRun ? new InMemoryStore(seed) : new MongoStore(config.mongoUri, config.mongoDb);
}
