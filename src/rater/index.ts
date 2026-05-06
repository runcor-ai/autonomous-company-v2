// External rater — V2-002 port (FR-061).
//
// Reads `daily_summary`-tagged MemoryNodes from runcor-memory; for each unscored summary,
// calls OpenRouter with the FROZEN rubric, parses the score, persists to rater.db.
// Scores are observer-side only; never fed back to the agent (Principle III + IX).

import type { MemorySystem, MemoryNode } from 'runcor-memory';
import { RaterStore } from './store.js';
import { RATER_SYSTEM_PROMPT, RATER_USER_PROMPT_PREFIX } from './rubric.js';
import { callOpenRouterChat, type OpenRouterCallArgs, type OpenRouterResponse } from './openrouter.js';

export interface RaterConfig {
  apiKey: string;
  model: string;
  store: RaterStore;
  /** Optional injected callable for tests. */
  callImpl?: (args: OpenRouterCallArgs) => Promise<OpenRouterResponse>;
}

export interface ScoredSummary {
  summaryNodeId: string;
  kind: 'v2' | 'control';
  dayNumber: number;
  score: number;
  rationale: string;
}

const SCORE_RE = /\{[\s\S]*?"score"[\s\S]*?\}/;

function dayNumberFromTags(tags: ReadonlyArray<string>): number {
  for (const t of tags) {
    if (t.startsWith('day:')) {
      const n = parseInt(t.slice(4), 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

export async function scoreOne(node: MemoryNode, kind: 'v2' | 'control', config: RaterConfig): Promise<ScoredSummary> {
  const dayNumber = dayNumberFromTags(node.tags ?? []);
  const userPrompt = RATER_USER_PROMPT_PREFIX + `kind=${kind} day-${dayNumber}\n\n${node.content}`;
  const call = config.callImpl ?? callOpenRouterChat;
  const result = await call({
    apiKey: config.apiKey,
    model: config.model,
    system: RATER_SYSTEM_PROMPT,
    user: userPrompt,
  });
  const m = result.text.match(SCORE_RE);
  if (!m) {
    throw new Error(`[rater] model output did not contain a JSON score object: ${result.text.slice(0, 200)}`);
  }
  let parsed: { score?: unknown; rationale?: unknown };
  try {
    parsed = JSON.parse(m[0]) as { score?: unknown; rationale?: unknown };
  } catch (err) {
    throw new Error(`[rater] JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed.score !== 'number' || parsed.score < -1 || parsed.score > 1) {
    throw new Error(`[rater] score must be number in [-1, +1], got: ${JSON.stringify(parsed.score)}`);
  }
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';
  config.store.addScore({
    summaryNodeId: node.id,
    kind,
    dayNumber,
    score: parsed.score,
    rationale,
    model: result.model,
  });
  return { summaryNodeId: node.id, kind, dayNumber, score: parsed.score, rationale };
}

/**
 * Score every unscored daily_summary MemoryNode in the given memory.
 * Caller distinguishes V2 vs control by passing the appropriate memory + kind.
 */
export async function scoreUnscored(memory: MemorySystem, kind: 'v2' | 'control', config: RaterConfig): Promise<ScoredSummary[]> {
  const summaries = memory.getAll().filter((n) => (n.tags ?? []).includes('daily_summary'));
  const out: ScoredSummary[] = [];
  for (const node of summaries) {
    if (config.store.hasScore(node.id)) continue;
    try {
      out.push(await scoreOne(node, kind, config));
    } catch (err) {
      // Best-effort: surface the error but continue scoring the next summary.
      console.error(`[rater] failed to score ${node.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
