// V2-local rater.db SQLite store. Persists scores produced by the external rater (FR-061).
// The rater is observer-side: scores never feed back to the agent (Principle III + IX).
//
// Schema:
//   summaries — rows keyed by memory_node_id (the daily_summary MemoryNode), tracking which
//               summaries have been scored
//   scores    — one row per rating; multiple ratings per summary are allowed (for re-runs /
//               model comparisons)

import Database from 'better-sqlite3';
import { rubricHash } from './rubric.js';

export interface ScoreRow {
  id: number;
  summaryNodeId: string;
  kind: 'v2' | 'control';
  dayNumber: number;
  score: number;
  rationale: string;
  model: string;
  rubric: string;
  createdAt: number;
}

export class RaterStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary_node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        day_number INTEGER NOT NULL,
        score REAL NOT NULL,
        rationale TEXT NOT NULL,
        model TEXT NOT NULL,
        rubric TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scores_node ON scores(summary_node_id);
      CREATE INDEX IF NOT EXISTS idx_scores_kind_day ON scores(kind, day_number);
    `);
  }

  /** Insert a new score row. Returns the inserted row. */
  addScore(args: {
    summaryNodeId: string;
    kind: 'v2' | 'control';
    dayNumber: number;
    score: number;
    rationale: string;
    model: string;
  }): ScoreRow {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO scores (summary_node_id, kind, day_number, score, rationale, model, rubric, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(args.summaryNodeId, args.kind, args.dayNumber, args.score, args.rationale, args.model, rubricHash(), now);
    return {
      id: Number(info.lastInsertRowid),
      summaryNodeId: args.summaryNodeId,
      kind: args.kind,
      dayNumber: args.dayNumber,
      score: args.score,
      rationale: args.rationale,
      model: args.model,
      rubric: rubricHash(),
      createdAt: now,
    };
  }

  /** Has this summary node already been scored (for the current rubric)? */
  hasScore(summaryNodeId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS x FROM scores WHERE summary_node_id = ? AND rubric = ? LIMIT 1
    `).get(summaryNodeId, rubricHash());
    return row !== undefined;
  }

  /** All scores, ordered by day. */
  list(opts: { kind?: 'v2' | 'control'; limit?: number } = {}): ScoreRow[] {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
    const sql = opts.kind
      ? `SELECT * FROM scores WHERE kind = ? ORDER BY day_number, id DESC LIMIT ?`
      : `SELECT * FROM scores ORDER BY day_number, id DESC LIMIT ?`;
    const stmt = this.db.prepare(sql);
    const rows = (opts.kind ? stmt.all(opts.kind, limit) : stmt.all(limit)) as Array<{
      id: number; summary_node_id: string; kind: string; day_number: number;
      score: number; rationale: string; model: string; rubric: string; created_at: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      summaryNodeId: r.summary_node_id,
      kind: r.kind as 'v2' | 'control',
      dayNumber: r.day_number,
      score: r.score,
      rationale: r.rationale,
      model: r.model,
      rubric: r.rubric,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
