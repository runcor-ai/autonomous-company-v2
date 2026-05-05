// V2 agent cycle — Phase 2 STUB.
// Phase 2 calls the Player directly with a minimal void-prompt.
// Phase 3 will replace with: substrate prompt-stack + dialectic + meta wrap +
// watchdog observe + coherence registration + memory persistence + drive recompute +
// temporal next-wake.

import type { Store } from '../shared/db.js';
import type { OpenRouterClient } from '../shared/openrouter.js';
import type { HarnessHandles } from './boot.js';

export interface AgentCycleInput {
  store: Store;
  openrouter: OpenRouterClient;
  harness: HarnessHandles;
  prompt: string;
  cycleNumber: number;
}

export interface AgentCycleResult {
  cycleId: number;
  text: string;
  costUsd: number;
  parsedAction?: { action: string; payload: unknown; thought?: string };
}

const ACTION_RE = /\{[\s\S]*?"action"[\s\S]*?\}/;

export async function runAgentCycle(input: AgentCycleInput): Promise<AgentCycleResult> {
  // Phase 2: every harness handle MUST be present (verified by Phase 3 init).
  // Constitution Principle V — non-negotiable. We assert presence here so the cycle
  // refuses to run if boot was skipped.
  for (const k of Object.keys(input.harness) as Array<keyof HarnessHandles>) {
    if (input.harness[k] !== 'PHASE3_STUB') {
      // Phase 3 will replace stub markers with real instances; until then the literal
      // check is the wiring guard. After Phase 3 lands, replace this with: throw if
      // any handle is missing/null.
      throw new Error(`agent harness slot '${k}' has unexpected value`);
    }
  }

  const cycle = input.store.startCycle('v2', input.cycleNumber);
  try {
    const r = await input.openrouter.complete({
      role: 'player',
      prompt: input.prompt,
      cycleId: cycle.id,
    });

    let parsed: AgentCycleResult['parsedAction'] | undefined;
    const m = r.text.match(ACTION_RE);
    if (m) {
      try {
        const obj = JSON.parse(m[0]) as Record<string, unknown>;
        if (typeof obj['action'] === 'string') {
          parsed = {
            action: obj['action'] as string,
            payload: obj['payload'],
            ...(typeof obj['thought'] === 'string' ? { thought: obj['thought'] as string } : {}),
          };
        }
      } catch { /* fall through */ }
    }

    input.store.completeCycle(cycle.id, 'complete');
    return {
      cycleId: cycle.id,
      text: r.text,
      costUsd: r.costUsd,
      ...(parsed !== undefined ? { parsedAction: parsed } : {}),
    };
  } catch (err) {
    input.store.completeCycle(cycle.id, 'failed');
    throw err;
  }
}
