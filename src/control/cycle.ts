// Control cycle — single Player call, no Coach, no Judge, no harness.
// Honors Constitution Principle X: control runs on the same rails as V2 minus
// the cognitive harness.

import type { OpenRouterClient } from '../shared/openrouter.js';
import type { Store } from '../shared/db.js';

export interface ControlCycleInput {
  store: Store;
  openrouter: OpenRouterClient;
  prompt: string;
  cycleNumber: number;
}

export interface ControlCycleResult {
  cycleId: number;
  text: string;
  costUsd: number;
  parsedAction?: { action: string; payload: unknown; thought?: string };
}

/** Extract the first balanced `{...}` JSON object from text. Returns null if none. */
function extractFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Run one control cycle. */
export async function runControlCycle(input: ControlCycleInput): Promise<ControlCycleResult> {
  const cycle = input.store.startCycle('control', input.cycleNumber);
  try {
    const r = await input.openrouter.complete({
      role: 'naive',
      prompt: input.prompt,
      cycleId: cycle.id,
    });

    let parsed: ControlCycleResult['parsedAction'] | undefined;
    const objText = extractFirstObject(r.text);
    if (objText !== null) {
      try {
        const obj = JSON.parse(objText) as Record<string, unknown>;
        if (typeof obj['action'] === 'string') {
          parsed = {
            action: obj['action'] as string,
            payload: obj['payload'],
            ...(typeof obj['thought'] === 'string' ? { thought: obj['thought'] as string } : {}),
          };
        }
      } catch { /* fall through — leave parsed undefined */ }
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
