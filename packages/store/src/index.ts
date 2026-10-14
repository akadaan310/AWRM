/**
 * Repository boundary. Synchronous by design: every write is durable (fsync'd
 * journal line or SQLite statement) before the caller proceeds, which is what
 * crash recovery (H-7) relies on.
 *
 * Backends:
 *  - MemoryStore  — tests
 *  - JsonlStore   — append-only journal, works on Node ≥ 20 (default)
 *  - SqliteStore  — node:sqlite (Node ≥ 22.5), same semantics
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { AwrmError } from '@awrm/core';

export interface Store {
  readonly kind: 'memory' | 'jsonl' | 'sqlite';
  readonly location: string | null;
  put(collection: string, id: string, doc: unknown): void;
  /** Write-once; returns false (and writes nothing) if the id exists. */
  putIfAbsent(collection: string, id: string, doc: unknown): boolean;
  get<T>(collection: string, id: string): T | undefined;
  list<T>(collection: string): T[];
  /** Diagnostics from opening (e.g. a torn final journal line). */
  readonly openReport: { replayedLines: number; tornLines: number };
  close(): void;
}

const COLLECTION = /^[a-z][a-z0-9-]{0,40}$/;
function checkKey(collection: string, id: string): void {
  if (!COLLECTION.test(collection)) throw new AwrmError('invalid-input', `bad collection ${collection}`);
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) throw new AwrmError('invalid-input', 'bad id');
}

export class MemoryStore implements Store {
  readonly kind: Store['kind'] = 'memory';
  readonly location: string | null = null;
  openReport = { replayedLines: 0, tornLines: 0 };
  protected data = new Map<string, Map<string, string>>();

  protected coll(c: string): Map<string, string> {
    let m = this.data.get(c);
    if (!m) this.data.set(c, (m = new Map()));
    return m;
  }
  protected apply(c: string, id: string, json: string): void {
    this.coll(c).set(id, json);
  }
  put(collection: string, id: string, doc: unknown): void {
    checkKey(collection, id);
    const json = JSON.stringify(doc);
    this.persist(collection, id, json);
    this.apply(collection, id, json);
  }
  putIfAbsent(collection: string, id: string, doc: unknown): boolean {
    checkKey(collection, id);
    if (this.coll(collection).has(id)) return false;
    this.put(collection, id, doc);
    return true;
  }
  get<T>(collection: string, id: string): T | undefined {
    const s = this.coll(collection).get(id);
    return s === undefined ? undefined : (JSON.parse(s) as T);
  }
  list<T>(collection: string): T[] {
    return [...this.coll(collection).values()].map((s) => JSON.parse(s) as T);
  }
  protected persist(_c: string, _id: string, _json: string): void {}
  close(): void {}
}

export class JsonlStore extends MemoryStore {
  override readonly kind: Store['kind'] = 'jsonl';
  override readonly location: string;
  private fd: number;

  constructor(dir: string) {
    super();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.location = join(dir, 'journal.jsonl');
    if (existsSync(this.location)) this.replay();
    this.fd = openSync(this.location, 'a', 0o600);
  }

  private replay(): void {
    const text = readFileSync(this.location, 'utf8');
    const lines = text.split('\n');
    let replayed = 0;
    let torn = 0;
    let validBytes = 0;
    lines.forEach((line, i) => {
      const last = i === lines.length - 1;
      if (!line) {
        if (!last) validBytes += 1;
        return;
      }
      try {
        const rec = JSON.parse(line) as { c: string; id: string; d: string };
        this.apply(rec.c, rec.id, rec.d);
        replayed++;
        validBytes += Buffer.byteLength(line) + (last ? 0 : 1);
      } catch {
        // Only a final, unterminated line can be torn by a crash mid-append.
        if (last) torn++;
        else throw new AwrmError('integrity', `journal corrupted at line ${i + 1}`);
      }
    });
    if (torn) truncateSync(this.location, validBytes); // drop the torn tail so later appends start clean
    this.openReport = { replayedLines: replayed, tornLines: torn };
  }

  protected override persist(c: string, id: string, json: string): void {
    writeSync(this.fd, JSON.stringify({ c, id, d: json }) + '\n');
    fsyncSync(this.fd);
  }

  override close(): void {
    closeSync(this.fd);
  }
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
  close(): void;
}

export function sqliteAvailable(): boolean {
  try {
    loadSqlite();
    return true;
  } catch {
    return false;
  }
}

function loadSqlite(): { DatabaseSync: new (path: string) => SqliteDb } {
  const req = createRequire(import.meta.url);
  const emit = process.emitWarning;
  process.emitWarning = (() => {}) as typeof process.emitWarning; // silence the experimental notice only
  try {
    return req('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDb };
  } finally {
    process.emitWarning = emit;
  }
}

export class SqliteStore implements Store {
  readonly kind: Store['kind'] = 'sqlite';
  readonly location: string;
  readonly openReport = { replayedLines: 0, tornLines: 0 };
  private db: SqliteDb;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.location = join(dir, 'awrm.sqlite');
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(this.location);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS docs (c TEXT NOT NULL, id TEXT NOT NULL, d TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (c, id))');
  }
  put(collection: string, id: string, doc: unknown): void {
    checkKey(collection, id);
    this.db
      .prepare('INSERT INTO docs (c, id, d, seq) VALUES (?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM docs)) ON CONFLICT (c, id) DO UPDATE SET d = excluded.d')
      .run(collection, id, JSON.stringify(doc));
  }
  putIfAbsent(collection: string, id: string, doc: unknown): boolean {
    checkKey(collection, id);
    if (this.get(collection, id) !== undefined) return false;
    this.put(collection, id, doc);
    return true;
  }
  get<T>(collection: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT d FROM docs WHERE c = ? AND id = ?').get(collection, id) as { d: string } | undefined;
    return row ? (JSON.parse(row.d) as T) : undefined;
  }
  list<T>(collection: string): T[] {
    return (this.db.prepare('SELECT d FROM docs WHERE c = ? ORDER BY seq').all(collection) as { d: string }[]).map((r) => JSON.parse(r.d) as T);
  }
  close(): void {
    this.db.close();
  }
}

export function openStore(spec: { kind: 'memory' } | { kind: 'jsonl' | 'sqlite'; dir: string }): Store {
  if (spec.kind === 'memory') return new MemoryStore();
  if (spec.kind === 'sqlite') return new SqliteStore(spec.dir);
  return new JsonlStore(spec.dir);
}
