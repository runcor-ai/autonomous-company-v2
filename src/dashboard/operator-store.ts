// V2 operator audit log (T141, FR-130, FR-131, FR-132, FR-133).
//
// `operator.db` is V2-local — distinct from any sibling-owned DB. Stores OperatorAction rows
// for /operator/pause | /resume | /note. The hash of the bearer token is recorded (not the
// token itself) so the audit log doesn't leak credentials but still distinguishes users
// when multiple operators share a single token-rotation pattern.

import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export type OperatorActionKind = 'pause' | 'resume' | 'infrastructure_note';

export interface OperatorAction {
  id: string;
  ts: number;
  kind: OperatorActionKind;
  payload?: { note?: string; scope?: 'v2' | 'control' | 'both' };
  authenticatedAs: string;
}

export class OperatorStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operator_actions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT,
        authenticated_as TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operator_actions_ts ON operator_actions(ts DESC);
    `);
  }

  /** Hash a bearer token to a stable id (for `authenticatedAs` field). */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 16);
  }

  append(action: { kind: OperatorActionKind; payload?: OperatorAction['payload']; authenticatedAs: string }): OperatorAction {
    const row: OperatorAction = {
      id: randomUUID(),
      ts: Date.now(),
      kind: action.kind,
      ...(action.payload ? { payload: action.payload } : {}),
      authenticatedAs: action.authenticatedAs,
    };
    this.db
      .prepare(
        'INSERT INTO operator_actions (id, ts, kind, payload_json, authenticated_as) VALUES (?, ?, ?, ?, ?)',
      )
      .run(row.id, row.ts, row.kind, row.payload ? JSON.stringify(row.payload) : null, row.authenticatedAs);
    return row;
  }

  list(opts: { limit?: number; before?: number } = {}): OperatorAction[] {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const before = opts.before ?? Date.now();
    const rows = this.db
      .prepare(
        'SELECT id, ts, kind, payload_json, authenticated_as, rowid FROM operator_actions WHERE ts <= ? ORDER BY ts DESC, rowid DESC LIMIT ?',
      )
      .all(before, limit) as Array<{
        id: string;
        ts: number;
        kind: string;
        payload_json: string | null;
        authenticated_as: string;
      }>;

    return rows.map((r) => {
      const out: OperatorAction = {
        id: r.id,
        ts: r.ts,
        kind: r.kind as OperatorActionKind,
        authenticatedAs: r.authenticated_as,
      };
      if (r.payload_json) {
        try {
          out.payload = JSON.parse(r.payload_json) as OperatorAction['payload'];
        } catch {
          // ignore
        }
      }
      return out;
    });
  }

  close(): void {
    this.db.close();
  }
}
