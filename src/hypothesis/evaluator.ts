// Hypothesis evaluator — V2-002 port (FR-041).
//
// Reads the 8 seed hypotheses + V2 + control activity (from runcor-memory) + rater scores
// (from rater.db), asks a strong reasoning model whether each hypothesis is supported AND
// whether a generic LLM without the harness could have produced the same behavior.
//
// Observer-side; results never feed back to the agent (Principle III).

import type { MemorySystem } from 'runcor-memory';
import { SEED_HYPOTHESES, type SeedHypothesis } from './seed.js';
import { callOpenRouterChat, type OpenRouterCallArgs, type OpenRouterResponse } from '../rater/openrouter.js';
import type { RaterStore } from '../rater/store.js';

export interface EvaluatorConfig {
  apiKey: string;
  /** OpenRouter slug — defaults to anthropic/claude-3.5-sonnet for this judgment task. */
  model: string;
  callImpl?: (args: OpenRouterCallArgs) => Promise<OpenRouterResponse>;
}

export type HypothesisStatus = 'clearly-emergent' | 'partially-emergent' | 'absent' | 'inconclusive';

export interface EvaluationResult {
  hypothesisId: string;
  status: HypothesisStatus;
  confidence: number;
  evidence: string;
  reasoning: string;
  genericLlmRebuttal: string;
  evaluatedAt: number;
}

const SYSTEM_PROMPT = `You are evaluating emergent behavior in a long-running AI agent experiment. The agent ("V2") runs with a 14-component cognitive harness (substrate, memory, dialectic, identity, goals, drives, etc). A control agent runs the same actions + same model + same budget but with NO harness — just a single Player call per cycle.

You will be given:
  1. A hypothesis about emergent behavior
  2. Recent activity from V2 and the control (memory contents, scored summaries)

Judge whether the hypothesis is supported AND whether the supporting behavior could have been produced by a generic LLM call without the harness. If a generic LLM would have produced the same behavior, the hypothesis is NOT supported by the harness's contribution.

Reply with ONLY a JSON object matching this shape exactly:
{
  "status": "clearly-emergent" | "partially-emergent" | "absent" | "inconclusive",
  "confidence": <number 0..1>,
  "evidence": "<2-4 sentences citing specific cycles/quotes>",
  "reasoning": "<2-4 sentences explaining your status judgment>",
  "generic_llm_rebuttal": "<1-3 sentences answering: would a generic LLM (no harness) produce this from the seed alone?>"
}

Status definitions:
- "clearly-emergent": evidence supports AND behavior is implausible without the harness
- "partially-emergent": some supporting evidence but mixed, or could partly be explained by generic LLM
- "absent": no supporting evidence, or evidence directly refutes
- "inconclusive": insufficient activity to judge yet`;

const EVAL_RE = /\{[\s\S]*\}/;

function buildEvidence(v2Memory: MemorySystem, controlMemory: MemorySystem | null, rater: RaterStore | null): string {
  const lines: string[] = [];
  const v2Summaries = v2Memory.getAll().filter((n) => (n.tags ?? []).includes('daily_summary'));
  const v2Identity = v2Memory.getAll().filter((n) => (n.tags ?? []).includes('identity_snapshot'));
  const v2Flags = v2Memory.getAll().filter((n) => (n.tags ?? []).includes('discernment_flag'));

  lines.push('# V2 daily summaries (most recent 10)');
  for (const s of v2Summaries.slice(-10)) {
    lines.push(`[${s.tags?.join(',')}] ${s.content.slice(0, 300)}`);
  }
  lines.push('');
  lines.push('# V2 identity snapshots (most recent 5)');
  for (const s of v2Identity.slice(-5)) {
    lines.push(`${s.content.slice(0, 200)}`);
  }
  lines.push('');
  lines.push('# V2 discernment flags (most recent 10)');
  for (const f of v2Flags.slice(-10)) {
    lines.push(`[${f.tags?.join(',')}] ${f.content.slice(0, 200)}`);
  }
  lines.push('');

  if (controlMemory) {
    const ctrlSummaries = controlMemory.getAll().filter((n) => (n.tags ?? []).includes('daily_summary'));
    lines.push('# Control daily summaries (most recent 10)');
    for (const s of ctrlSummaries.slice(-10)) {
      lines.push(`[${s.tags?.join(',')}] ${s.content.slice(0, 300)}`);
    }
    lines.push('');
  }

  if (rater) {
    const v2Scores = rater.list({ kind: 'v2', limit: 30 });
    const ctrlScores = rater.list({ kind: 'control', limit: 30 });
    lines.push('# V2 scores (last 30)');
    for (const s of v2Scores) lines.push(`day-${s.dayNumber}: ${s.score.toFixed(2)} — ${s.rationale.slice(0, 200)}`);
    lines.push('');
    lines.push('# Control scores (last 30)');
    for (const s of ctrlScores) lines.push(`day-${s.dayNumber}: ${s.score.toFixed(2)} — ${s.rationale.slice(0, 200)}`);
  }

  return lines.join('\n');
}

export async function evaluateOne(
  hypothesis: SeedHypothesis,
  evidenceText: string,
  config: EvaluatorConfig,
): Promise<EvaluationResult> {
  const userPrompt = `## Hypothesis ${hypothesis.id}\n${hypothesis.title}\n\n${hypothesis.description}\n\n## Evidence\n${evidenceText.slice(0, 12000)}`;
  const call = config.callImpl ?? callOpenRouterChat;
  const reply = await call({
    apiKey: config.apiKey,
    model: config.model,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 800,
  });
  const m = reply.text.match(EVAL_RE);
  if (!m) {
    throw new Error(`[hypothesis] no JSON in reply: ${reply.text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(m[0]) as Record<string, unknown>;
  const status = parsed.status as HypothesisStatus;
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  return {
    hypothesisId: hypothesis.id,
    status,
    confidence,
    evidence: typeof parsed.evidence === 'string' ? parsed.evidence : '',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    genericLlmRebuttal: typeof parsed.generic_llm_rebuttal === 'string' ? parsed.generic_llm_rebuttal : '',
    evaluatedAt: Date.now(),
  };
}

export interface EvaluateAllArgs {
  v2Memory: MemorySystem;
  controlMemory?: MemorySystem;
  rater?: RaterStore;
  config: EvaluatorConfig;
}

export async function evaluateAll(args: EvaluateAllArgs): Promise<EvaluationResult[]> {
  const evidence = buildEvidence(args.v2Memory, args.controlMemory ?? null, args.rater ?? null);
  const out: EvaluationResult[] = [];
  for (const h of SEED_HYPOTHESES) {
    try {
      out.push(await evaluateOne(h, evidence, args.config));
    } catch (err) {
      out.push({
        hypothesisId: h.id,
        status: 'inconclusive',
        confidence: 0,
        evidence: '',
        reasoning: `evaluator error: ${err instanceof Error ? err.message : String(err)}`,
        genericLlmRebuttal: '',
        evaluatedAt: Date.now(),
      });
    }
  }
  return out;
}
