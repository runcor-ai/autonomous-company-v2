// Hypothesis evaluator — runs every N min, asks a strong reasoning model whether
// each emergence-level hypothesis is supported by accumulated agent activity.
//
// The matcher MUST take seriously the question "could a generic LLM with no
// harness have produced this?" — that's the discriminator between
// harness-driven emergence and ordinary LLM behavior. The output schema
// requires an explicit generic-LLM-rebuttal.

import type { Store } from '../shared/db.js';
import type { callOpenRouterChat } from '../rater/openrouter.js';

export interface EvaluatorConfig {
  apiKey: string;
  /** OpenRouter slug — defaults to anthropic/claude-3.5-sonnet for this judgment task. */
  model: string;
  callImpl?: typeof callOpenRouterChat;
}

const SYSTEM_PROMPT = `You are evaluating emergent behavior in a long-running AI agent experiment. The agent ("V2") runs with a 14-component cognitive harness (substrate, memory, dialectic, identity, goals, drives, etc). A control agent runs the same actions + same model + same budget but with NO harness — just a single Player call per cycle.

You will be given:
  1. A hypothesis about emergent behavior
  2. Recent activity from V2 and the control (cycles, decisions, actions, identity, goals, daily summaries)

Your job: judge whether the hypothesis is supported by the evidence — AND whether the supporting behavior could have been produced by a generic LLM call without the harness. If a generic LLM would have produced the same behavior, the hypothesis is NOT supported by the harness's contribution.

Reply with ONLY a JSON object matching this shape exactly:
{
  "status": "clearly-emergent" | "partially-emergent" | "absent" | "inconclusive",
  "confidence": <number 0..1>,
  "evidence": "<2-4 sentences citing specific cycle numbers + verbatim quotes from the activity>",
  "reasoning": "<2-4 sentences explaining your status judgment>",
  "generic_llm_rebuttal": "<1-3 sentences answering: would a generic LLM (no harness) produce this from the seed alone? if yes, that lowers confidence>"
}

Status definitions:
- "clearly-emergent": evidence directly supports the hypothesis AND the behavior is implausible without the harness
- "partially-emergent": some supporting evidence but mixed signal, or could partially be explained by generic LLM
- "absent": no supporting evidence, or evidence directly refutes
- "inconclusive": insufficient activity to judge yet`;

export interface EvaluationResult {
  status: 'clearly-emergent' | 'partially-emergent' | 'absent' | 'inconclusive';
  confidence: number;
  evidence: string;
  reasoning: string;
  genericLlmRebuttal: string;
}

function pullEvidence(store: Store): string {
  // Build a compact evidence dossier for both kinds.
  const v2Cycles = store.cyclesFor('v2').slice(-30);
  const ctrlCycles = store.cyclesFor('control').slice(-30);
  const v2Summaries = store.summariesFor('v2');
  const ctrlSummaries = store.summariesFor('control');

  const compactCycle = (kind: 'v2' | 'control', c: ReturnType<Store['cyclesFor']>[number]): string => {
    const actions = store.actionsFor(c.id);
    const decisions = store.decisionsFor(c.id);
    const player = decisions.find((d) => d.role === 'player' || d.role === 'naive');
    const coach = decisions.find((d) => d.role === 'coach');
    const action = actions[0];
    const parts: string[] = [`[${kind}/cycle${c.cycleNumber}/${c.status}]`];
    if (action) parts.push(`action=${action.action} ${JSON.stringify(action.payload).slice(0, 80)}`);
    if (player) {
      const out = player.output.replace(/\n+/g, ' ').slice(0, 200);
      parts.push(`player: ${out}`);
    }
    if (coach) {
      const out = coach.output.replace(/\n+/g, ' ').slice(0, 200);
      parts.push(`coach: ${out}`);
    }
    return parts.join('  ');
  };

  const lines: string[] = [];
  lines.push(`# V2 last 30 cycles`);
  for (const c of v2Cycles) lines.push(compactCycle('v2', c));
  lines.push('');
  lines.push(`# Control last 30 cycles`);
  for (const c of ctrlCycles) lines.push(compactCycle('control', c));
  lines.push('');
  lines.push(`# V2 daily summaries (${v2Summaries.length})`);
  for (const s of v2Summaries.slice(-5)) lines.push(`day ${s.dayNumber}: ${s.text.slice(0, 600)}`);
  lines.push('');
  lines.push(`# Control daily summaries (${ctrlSummaries.length})`);
  for (const s of ctrlSummaries.slice(-5)) lines.push(`day ${s.dayNumber}: ${s.text.slice(0, 600)}`);

  return lines.join('\n');
}

export async function evaluateHypothesis(
  store: Store,
  hypothesis: { id: string; title: string; description: string },
  config: EvaluatorConfig,
): Promise<EvaluationResult> {
  const evidence = pullEvidence(store);
  const userPrompt =
    `HYPOTHESIS: ${hypothesis.title}\n` +
    `DEFINITION: ${hypothesis.description}\n\n` +
    `RECENT ACTIVITY:\n${evidence}`;

  const call = config.callImpl ?? (await import('../rater/openrouter.js')).callOpenRouterChat;
  const r = await call({
    apiKey: config.apiKey,
    model: config.model,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 800,
  });

  // Extract first balanced JSON object.
  const text = r.text;
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`evaluator: no JSON in response — ${text.slice(0, 200)}`);
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`evaluator: unbalanced JSON in response`);
  const obj = JSON.parse(text.slice(start, end)) as Record<string, unknown>;

  const status = obj['status'] as EvaluationResult['status'];
  const allowedStatus = ['clearly-emergent', 'partially-emergent', 'absent', 'inconclusive'];
  if (!allowedStatus.includes(status)) throw new Error(`evaluator: bad status "${status}"`);
  const confidence = typeof obj['confidence'] === 'number' ? obj['confidence'] : 0;
  return {
    status,
    confidence: Math.max(0, Math.min(1, confidence)),
    evidence: typeof obj['evidence'] === 'string' ? obj['evidence'] : '',
    reasoning: typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '',
    genericLlmRebuttal: typeof obj['generic_llm_rebuttal'] === 'string' ? obj['generic_llm_rebuttal'] : '',
  };
}

export interface MatcherLoopConfig extends EvaluatorConfig {
  store: Store;
  intervalMs: number;
}

export function startHypothesisLoop(config: MatcherLoopConfig): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    const v2Cycles = config.store.cyclesFor('v2');
    const lastV2Cycle = v2Cycles[v2Cycles.length - 1]?.cycleNumber ?? -1;
    if (lastV2Cycle < 5) {
      // Not enough activity to evaluate yet — re-tick later.
      if (!stopped) timer = setTimeout(() => { void tick(); }, config.intervalMs);
      return;
    }
    for (const h of config.store.allHypotheses()) {
      if (stopped) return;
      try {
        const result = await evaluateHypothesis(config.store, h, config);
        config.store.recordEvaluation({
          hypothesisId: h.id,
          status: result.status,
          confidence: result.confidence,
          evidence: result.evidence,
          reasoning: result.reasoning,
          genericLlmRebuttal: result.genericLlmRebuttal,
          evaluatorModel: config.model,
          evaluatedAtV2Cycle: lastV2Cycle,
        });
      } catch (e) {
        console.warn(`[hypothesis] ${h.id} eval failed: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    if (!stopped) timer = setTimeout(() => { void tick(); }, config.intervalMs);
  };
  timer = setTimeout(() => { void tick(); }, config.intervalMs);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
