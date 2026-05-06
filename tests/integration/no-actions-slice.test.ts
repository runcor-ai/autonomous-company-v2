// T101 [US3] — V2's prompt MUST NOT carry a literal `actions` field with raw rows from
// prior cycles. The cycle context comes from memory recall + reality slice + drives + goals,
// NOT a sliding window of action rows. (FR-075)

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('T101: no actions[] slice in cycle prompt (FR-075)', () => {
  test('context-builder.ts does NOT pass an actions array into LayerContext', async () => {
    const src = await readFile(path.resolve('src/agent/context-builder.ts'), 'utf8');
    // The LayerContext type doesn't carry an `actions` field; we still verify by inspection
    // that no field literally named `actions:` is being added to the constructed layerContext.
    const layerContextLiteral = src.match(/const layerContext: LayerContext\s*=\s*\{[\s\S]*?\};/);
    expect(layerContextLiteral).not.toBeNull();
    const literal = layerContextLiteral![0];
    expect(literal).not.toMatch(/\bactions\s*:/);
  });

  test('substrate-layers do not declare an actions field in render output', async () => {
    const memoryRecall = await readFile(path.resolve('src/substrate-layers/memory-recall.ts'), 'utf8');
    const drives = await readFile(path.resolve('src/substrate-layers/drives.ts'), 'utf8');
    const goals = await readFile(path.resolve('src/substrate-layers/goals.ts'), 'utf8');
    const identity = await readFile(path.resolve('src/substrate-layers/identity.ts'), 'utf8');
    const capabilities = await readFile(path.resolve('src/substrate-layers/capabilities.ts'), 'utf8');
    const reality = await readFile(path.resolve('src/substrate-layers/reality.ts'), 'utf8');
    for (const src of [memoryRecall, drives, goals, identity, capabilities, reality]) {
      // Layer outputs are plain strings; ensure no `actions[]` JSON-style template is
      // hardcoded in any layer.
      expect(src).not.toMatch(/"actions"\s*:/);
      expect(src).not.toMatch(/'actions'\s*:/);
    }
  });

  test('prompt-stack assembly imports come from runcor-substrate (no hand-rolled cycle prompt)', async () => {
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    // FR-014: cycle prompt comes from prompt-stack, not hand assembly.
    expect(src).not.toMatch(/LAWS\s*=\s*\[/);
    expect(src).not.toMatch(/const LAWS_BLOCK\b/);
    expect(src).not.toMatch(/"TASK:"/);
  });
});
