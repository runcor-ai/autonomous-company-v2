// T166 [US1] — cycle-0 prompt has no commercial words (FR-003 enforcement; addresses C3).
// We verify by exercising the prompt-stack assembly with a cycle-0 LayerContext and grepping
// the assembled output. The FR-003 forbidden vocabulary: sell|earn|customer|revenue|profit|MRR.

import { describe, expect, test } from 'vitest';
import { Substrate, LawsLayer } from 'runcor-substrate';
import type { LayerContext } from 'runcor-substrate';
import {
  V2RealityLayer,
  DrivesLayer,
  GoalsLayer,
  IdentityLayer,
  CapabilitiesLayer,
  MemoryRecallLayer,
} from '../../src/substrate-layers/index.js';

// Word-boundary on both sides; MRR/ARR case-sensitive to avoid false-matches like "Array".
const FORBIDDEN_LOWER_RE = /\b(sell|sold|selling|earn|earning|earnings|customer|customers|revenue|profit|profits|monetize|monetized|monetization)\b/i;
const FORBIDDEN_ACRONYM_RE = /\b(MRR|ARR)\b/;
function isForbidden(text: string): boolean {
  return FORBIDDEN_LOWER_RE.test(text) || FORBIDDEN_ACRONYM_RE.test(text);
}

function buildCycleZeroContext(): LayerContext {
  return {
    cycle: 0,
    agentRole: 'v2',
    baseRequest: { prompt: 'choose your next action' },
    drives: { resource: 0.1, curiosity: 0.0, reactivity: 0.0, coherence: 0.0 },
    topGoal: null,
    identitySelfTheory: null,
    lastPlanPrecis: null,
    recalledNodes: [],
    realitySlice: null,
    capabilityList: [],
  };
}

describe('T166: cycle-0 prompt contains no commercial vocabulary (FR-003)', () => {
  test('assembled prompt-stack output for cycle-0 contains no forbidden words', () => {
    const transient = new Substrate();
    const substrate = new Substrate({
      layers: [
        new LawsLayer(transient.lawsPrompt),
        new V2RealityLayer(),
        new DrivesLayer(),
        new GoalsLayer(),
        new IdentityLayer(),
        new CapabilitiesLayer(),
        new MemoryRecallLayer(),
      ],
    });
    const assembled = substrate.promptStack.assemble(buildCycleZeroContext());
    expect(isForbidden(assembled)).toBe(false);
  });

  test('individual V2 substrate layers contain no forbidden words in source', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const layerFiles = [
      'src/substrate-layers/drives.ts',
      'src/substrate-layers/goals.ts',
      'src/substrate-layers/identity.ts',
      'src/substrate-layers/capabilities.ts',
      'src/substrate-layers/memory-recall.ts',
      'src/substrate-layers/reality.ts',
    ];
    for (const file of layerFiles) {
      const src = await readFile(path.resolve(file), 'utf8');
      // Only check string literals + template fragments; comments are allowed to mention
      // the forbidden words for context. Grep heuristic: look outside ` /* ... */` blocks.
      // Simpler: extract content between single + double quotes + template-literal backticks.
      const stringContents = [
        ...src.matchAll(/'([^'\\]|\\.)*'/g),
        ...src.matchAll(/"([^"\\]|\\.)*"/g),
        ...src.matchAll(/`([^`\\]|\\.)*`/g),
      ].map((m) => m[0]);
      for (const s of stringContents) {
        // Allow the eslint-style label "category" string from goals; commercial vocab specifically.
        if (isForbidden(s)) {
          throw new Error(`Forbidden commercial word in ${file}: ${s}`);
        }
      }
    }
  });
});
