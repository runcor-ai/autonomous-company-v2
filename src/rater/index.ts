// External rater — polls for unscored summaries, calls Anthropic with the frozen
// rubric, persists the score. Per Constitution Principle III + IX, scores are
// observer-side only and never fed back to the agent.

import type { Store } from '../shared/db.js';
import type { ScoreRecord, SummaryRecord } from '../shared/types.js';
import { callAnthropic } from './anthropic.js';
import { RATER_SYSTEM_PROMPT, RATER_USER_PROMPT_PREFIX, rubricHash } from './rubric.js';

export interface RaterConfig {
  apiKey: string;
  model: string;
  store: Store;
  /** For tests / dependency injection. */
  callImpl?: typeof callAnthropic;
}

export interface ScoreOneResult {
  summary: SummaryRecord;
  scoreRecord: ScoreRecord;
}

const SCORE_RE = /\{[\s\S]*?"score"[\s\S]*?\}/;

/** Score one summary. Extracts {score, rationale} from the model reply. */
export async function scoreSummary(summary: SummaryRecord, config: RaterConfig): Promise<ScoreRecord> {
  const call = config.callImpl ?? callAnthropic;
  const userPrompt =
    RATER_USER_PROMPT_PREFIX +
    `kind=${summary.kind} day-${summary.dayNumber}\n\n${summary.text}`;
  const result = await call({
    apiKey: config.apiKey,
    model: config.model,
    system: RATER_SYSTEM_PROMPT,
    user: userPrompt,
  });

  const m = result.text.match(SCORE_RE);
  if (!m) {
    throw new Error(`rater: model output did not contain a JSON score object — got: ${result.text.slice(0, 200)}`);
  }
  let score: number;
  let rationale: string;
  try {
    const obj = JSON.parse(m[0]) as { score?: unknown; rationale?: unknown };
    if (typeof obj.score !== 'number' || obj.score < -1 || obj.score > 1) {
      throw new Error(`rater: score must be number in [-1, +1], got: ${JSON.stringify(obj.score)}`);
    }
    if (typeof obj.rationale !== 'string') {
      throw new Error(`rater: rationale must be string, got: ${JSON.stringify(obj.rationale)}`);
    }
    score = obj.score;
    rationale = obj.rationale;
  } catch (e) {
    throw new Error(`rater: parse failed — ${(e as Error).message}`);
  }

  return config.store.addScore(summary.id, score, rationale, config.model);
}

/** Score every unscored summary currently in the store. Returns the records produced. */
export async function scoreAllUnscored(config: RaterConfig): Promise<ScoreRecord[]> {
  const out: ScoreRecord[] = [];
  for (const s of config.store.unscoredSummaries()) {
    out.push(await scoreSummary(s, config));
  }
  return out;
}

/**
 * Long-running rater loop — periodically scores any new summaries.
 * Returns a stop function that cancels the loop on next tick.
 *
 * The first tick fires AFTER intervalMs (not immediately) so tests that pass
 * a long intervalMs can boot the rater without it making an HTTP call.
 */
export function startRaterLoop(config: RaterConfig & { intervalMs: number }): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try { await scoreAllUnscored(config); } catch { /* swallow — next tick will retry */ }
    if (!stopped) timer = setTimeout(() => { void tick(); }, config.intervalMs);
  };
  timer = setTimeout(() => { void tick(); }, config.intervalMs);
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export { RATER_SYSTEM_PROMPT, RATER_USER_PROMPT_PREFIX, rubricHash };
