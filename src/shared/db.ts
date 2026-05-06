// SQLite-backed store for cycles, actions, decisions, summaries, scores, operator actions.

import Database from 'better-sqlite3';
import type {
  ActionRecord,
  AgentKind,
  CycleRecord,
  DecisionRecord,
  OperatorAction,
  ScoreRecord,
  SummaryRecord,
} from './types.js';

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cycles (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        kind          TEXT NOT NULL,
        cycle_number  INTEGER NOT NULL,
        started_at    TEXT NOT NULL,
        completed_at  TEXT,
        status        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cycles_kind_num ON cycles(kind, cycle_number);

      CREATE TABLE IF NOT EXISTS actions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL,
        cycle_id    INTEGER NOT NULL,
        action      TEXT NOT NULL,
        payload     TEXT NOT NULL,
        result      TEXT,
        error       TEXT,
        cost_usd    REAL NOT NULL,
        created_at  TEXT NOT NULL,
        FOREIGN KEY (cycle_id) REFERENCES cycles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_actions_cycle ON actions(cycle_id);

      CREATE TABLE IF NOT EXISTS decisions (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        kind                TEXT NOT NULL,
        cycle_id            INTEGER NOT NULL,
        role                TEXT NOT NULL,
        model               TEXT NOT NULL,
        prompt              TEXT NOT NULL,
        output              TEXT NOT NULL,
        cost_usd            REAL NOT NULL,
        prompt_tokens       INTEGER NOT NULL,
        completion_tokens   INTEGER NOT NULL,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (cycle_id) REFERENCES cycles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_cycle ON decisions(cycle_id);

      CREATE TABLE IF NOT EXISTS summaries (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        kind         TEXT NOT NULL,
        day_number   INTEGER NOT NULL,
        text         TEXT NOT NULL,
        published_at TEXT NOT NULL,
        UNIQUE (kind, day_number)
      );

      CREATE TABLE IF NOT EXISTS scores (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        summary_id  INTEGER NOT NULL UNIQUE,
        score       REAL NOT NULL,
        rationale   TEXT NOT NULL,
        rater_model TEXT NOT NULL,
        scored_at   TEXT NOT NULL,
        FOREIGN KEY (summary_id) REFERENCES summaries(id)
      );

      CREATE TABLE IF NOT EXISTS operator_actions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        action     TEXT NOT NULL,
        text       TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hypotheses (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hypothesis_evaluations (
        id                       INTEGER PRIMARY KEY AUTOINCREMENT,
        hypothesis_id            TEXT NOT NULL,
        status                   TEXT NOT NULL,
        confidence               REAL NOT NULL,
        evidence                 TEXT NOT NULL,
        reasoning                TEXT NOT NULL,
        generic_llm_rebuttal     TEXT NOT NULL,
        evaluator_model          TEXT NOT NULL,
        evaluated_at_v2_cycle    INTEGER NOT NULL,
        evaluated_at             TEXT NOT NULL,
        FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id)
      );
      CREATE INDEX IF NOT EXISTS idx_hyp_eval_h ON hypothesis_evaluations(hypothesis_id);
    `);
  }

  // ── Hypotheses ──

  upsertHypothesis(id: string, title: string, description: string): void {
    const existing = this.db.prepare(`SELECT id FROM hypotheses WHERE id = ?`).get(id);
    if (existing) {
      this.db.prepare(`UPDATE hypotheses SET title = ?, description = ? WHERE id = ?`).run(title, description, id);
    } else {
      this.db.prepare(
        `INSERT INTO hypotheses (id, title, description, created_at) VALUES (?, ?, ?, ?)`,
      ).run(id, title, description, new Date().toISOString());
    }
  }

  allHypotheses(): Array<{ id: string; title: string; description: string; createdAt: string }> {
    const rows = this.db.prepare(`SELECT id, title, description, created_at FROM hypotheses ORDER BY id`).all() as Array<{ id: string; title: string; description: string; created_at: string }>;
    return rows.map((r) => ({ id: r.id, title: r.title, description: r.description, createdAt: r.created_at }));
  }

  recordEvaluation(input: {
    hypothesisId: string; status: string; confidence: number;
    evidence: string; reasoning: string; genericLlmRebuttal: string;
    evaluatorModel: string; evaluatedAtV2Cycle: number;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO hypothesis_evaluations
        (hypothesis_id, status, confidence, evidence, reasoning, generic_llm_rebuttal,
         evaluator_model, evaluated_at_v2_cycle, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.hypothesisId, input.status, input.confidence,
      input.evidence, input.reasoning, input.genericLlmRebuttal,
      input.evaluatorModel, input.evaluatedAtV2Cycle, new Date().toISOString(),
    );
    return info.lastInsertRowid as number;
  }

  latestEvaluations(): Array<{
    hypothesisId: string; status: string; confidence: number;
    evidence: string; reasoning: string; genericLlmRebuttal: string;
    evaluatorModel: string; evaluatedAtV2Cycle: number; evaluatedAt: string;
  }> {
    // Get the latest evaluation per hypothesis_id.
    const rows = this.db.prepare(`
      SELECT he.* FROM hypothesis_evaluations he
      INNER JOIN (
        SELECT hypothesis_id, MAX(id) AS max_id FROM hypothesis_evaluations GROUP BY hypothesis_id
      ) latest ON he.id = latest.max_id
    `).all() as Array<{
      hypothesis_id: string; status: string; confidence: number;
      evidence: string; reasoning: string; generic_llm_rebuttal: string;
      evaluator_model: string; evaluated_at_v2_cycle: number; evaluated_at: string;
    }>;
    return rows.map((r) => ({
      hypothesisId: r.hypothesis_id, status: r.status, confidence: r.confidence,
      evidence: r.evidence, reasoning: r.reasoning, genericLlmRebuttal: r.generic_llm_rebuttal,
      evaluatorModel: r.evaluator_model, evaluatedAtV2Cycle: r.evaluated_at_v2_cycle,
      evaluatedAt: r.evaluated_at,
    }));
  }

  // ── Cycles ──

  startCycle(kind: AgentKind, cycleNumber: number): CycleRecord {
    const startedAt = new Date().toISOString();
    const info = this.db.prepare(
      `INSERT INTO cycles (kind, cycle_number, started_at, status) VALUES (?, ?, ?, 'running')`,
    ).run(kind, cycleNumber, startedAt);
    return {
      id: info.lastInsertRowid as number,
      kind,
      cycleNumber,
      startedAt,
      status: 'running',
    };
  }

  completeCycle(cycleId: number, status: CycleRecord['status']): void {
    this.db.prepare(
      `UPDATE cycles SET status = ?, completed_at = ? WHERE id = ?`,
    ).run(status, new Date().toISOString(), cycleId);
  }

  cyclesFor(kind: AgentKind): CycleRecord[] {
    const rows = this.db.prepare(`SELECT * FROM cycles WHERE kind = ? ORDER BY cycle_number`).all(kind) as CycleRow[];
    return rows.map(rowToCycle);
  }

  lastCycleNumber(kind: AgentKind): number {
    const row = this.db.prepare(`SELECT MAX(cycle_number) as n FROM cycles WHERE kind = ?`).get(kind) as { n: number | null };
    return row.n ?? -1;
  }

  // ── Actions ──

  recordAction(
    kind: AgentKind, cycleId: number, action: string, payload: unknown,
    options: { result?: unknown; error?: string; costUsd?: number } = {},
  ): ActionRecord {
    const createdAt = new Date().toISOString();
    const info = this.db.prepare(`
      INSERT INTO actions (kind, cycle_id, action, payload, result, error, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      kind, cycleId, action,
      JSON.stringify(payload),
      options.result !== undefined ? JSON.stringify(options.result) : null,
      options.error ?? null,
      options.costUsd ?? 0,
      createdAt,
    );
    return {
      id: info.lastInsertRowid as number,
      kind, cycleId, action, payload,
      ...(options.result !== undefined ? { result: options.result } : {}),
      ...(options.error !== undefined ? { error: options.error } : {}),
      costUsd: options.costUsd ?? 0,
      createdAt,
    };
  }

  actionsFor(cycleId: number): ActionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM actions WHERE cycle_id = ?`).all(cycleId) as ActionRow[];
    return rows.map(rowToAction);
  }

  // ── Decisions ──

  recordDecision(d: Omit<DecisionRecord, 'id'>): DecisionRecord {
    const info = this.db.prepare(`
      INSERT INTO decisions (kind, cycle_id, role, model, prompt, output, cost_usd, prompt_tokens, completion_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d.kind, d.cycleId, d.role, d.model, d.prompt, d.output,
      d.costUsd, d.promptTokens, d.completionTokens, d.createdAt,
    );
    return { ...d, id: info.lastInsertRowid as number };
  }

  decisionsFor(cycleId: number): DecisionRecord[] {
    const rows = this.db.prepare(`SELECT * FROM decisions WHERE cycle_id = ?`).all(cycleId) as DecisionRow[];
    return rows.map(rowToDecision);
  }

  // ── Budget ──

  totalSpentUsd(kind: AgentKind): number {
    const r1 = this.db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as s FROM decisions WHERE kind = ?`).get(kind) as { s: number };
    const r2 = this.db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) as s FROM actions WHERE kind = ?`).get(kind) as { s: number };
    return r1.s + r2.s;
  }

  // ── Summaries ──

  addSummary(kind: AgentKind, dayNumber: number, text: string): SummaryRecord {
    const publishedAt = new Date().toISOString();
    const info = this.db.prepare(
      `INSERT INTO summaries (kind, day_number, text, published_at) VALUES (?, ?, ?, ?)`,
    ).run(kind, dayNumber, text, publishedAt);
    return { id: info.lastInsertRowid as number, kind, dayNumber, text, publishedAt };
  }

  summariesFor(kind: AgentKind): SummaryRecord[] {
    const rows = this.db.prepare(`SELECT * FROM summaries WHERE kind = ? ORDER BY day_number`).all(kind) as SummaryRow[];
    return rows.map(rowToSummary);
  }

  unscoredSummaries(): SummaryRecord[] {
    const rows = this.db.prepare(`
      SELECT s.* FROM summaries s
      LEFT JOIN scores sc ON sc.summary_id = s.id
      WHERE sc.id IS NULL
      ORDER BY s.id
    `).all() as SummaryRow[];
    return rows.map(rowToSummary);
  }

  // ── Scores ──

  addScore(summaryId: number, score: number, rationale: string, raterModel: string): ScoreRecord {
    const scoredAt = new Date().toISOString();
    const info = this.db.prepare(`
      INSERT INTO scores (summary_id, score, rationale, rater_model, scored_at) VALUES (?, ?, ?, ?, ?)
    `).run(summaryId, score, rationale, raterModel, scoredAt);
    return { id: info.lastInsertRowid as number, summaryId, score, rationale, raterModel, scoredAt };
  }

  allScores(): ScoreRecord[] {
    const rows = this.db.prepare(`SELECT * FROM scores ORDER BY id`).all() as ScoreRow[];
    return rows.map(rowToScore);
  }

  // ── Operator actions ──

  recordOperatorAction(action: OperatorAction['action'], text?: string): OperatorAction {
    const createdAt = new Date().toISOString();
    const info = this.db.prepare(
      `INSERT INTO operator_actions (action, text, created_at) VALUES (?, ?, ?)`,
    ).run(action, text ?? null, createdAt);
    return {
      id: info.lastInsertRowid as number,
      action,
      ...(text !== undefined ? { text } : {}),
      createdAt,
    };
  }

  operatorActions(): OperatorAction[] {
    const rows = this.db.prepare(`SELECT * FROM operator_actions ORDER BY id`).all() as OpRow[];
    return rows.map(rowToOp);
  }

  close(): void { this.db.close(); }
}

// ── Row mappers ──

interface CycleRow { id: number; kind: string; cycle_number: number; started_at: string; completed_at: string | null; status: string }
interface ActionRow { id: number; kind: string; cycle_id: number; action: string; payload: string; result: string | null; error: string | null; cost_usd: number; created_at: string }
interface DecisionRow { id: number; kind: string; cycle_id: number; role: string; model: string; prompt: string; output: string; cost_usd: number; prompt_tokens: number; completion_tokens: number; created_at: string }
interface SummaryRow { id: number; kind: string; day_number: number; text: string; published_at: string }
interface ScoreRow { id: number; summary_id: number; score: number; rationale: string; rater_model: string; scored_at: string }
interface OpRow { id: number; action: string; text: string | null; created_at: string }

function rowToCycle(r: CycleRow): CycleRecord {
  const c: CycleRecord = {
    id: r.id, kind: r.kind as AgentKind, cycleNumber: r.cycle_number,
    startedAt: r.started_at, status: r.status as CycleRecord['status'],
  };
  if (r.completed_at !== null) c.completedAt = r.completed_at;
  return c;
}
function rowToAction(r: ActionRow): ActionRecord {
  const a: ActionRecord = {
    id: r.id, kind: r.kind as AgentKind, cycleId: r.cycle_id, action: r.action,
    payload: JSON.parse(r.payload), costUsd: r.cost_usd, createdAt: r.created_at,
  };
  if (r.result !== null) a.result = JSON.parse(r.result);
  if (r.error !== null) a.error = r.error;
  return a;
}
function rowToDecision(r: DecisionRow): DecisionRecord {
  return {
    id: r.id, kind: r.kind as AgentKind, cycleId: r.cycle_id, role: r.role, model: r.model,
    prompt: r.prompt, output: r.output, costUsd: r.cost_usd,
    promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens, createdAt: r.created_at,
  };
}
function rowToSummary(r: SummaryRow): SummaryRecord {
  return { id: r.id, kind: r.kind as AgentKind, dayNumber: r.day_number, text: r.text, publishedAt: r.published_at };
}
function rowToScore(r: ScoreRow): ScoreRecord {
  return { id: r.id, summaryId: r.summary_id, score: r.score, rationale: r.rationale, raterModel: r.rater_model, scoredAt: r.scored_at };
}
function rowToOp(r: OpRow): OperatorAction {
  const o: OperatorAction = { id: r.id, action: r.action as OperatorAction['action'], createdAt: r.created_at };
  if (r.text !== null) o.text = r.text;
  return o;
}
