// T102 [US3] — `memory.cycle()` invoked exactly once per V2 cycle, at cycle end (research.md §R9).

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('T102: memory.cycle() once per cycle, at end (R9)', () => {
  test('side-effects.ts contains exactly one args.memory.cycle() invocation', async () => {
    const src = await readFile(path.resolve('src/agent/side-effects.ts'), 'utf8');
    const matches = src.match(/args\.memory\.cycle\(\)/g) ?? [];
    expect(matches.length).toBe(1);
  });

  test('memory.cycle() is the LAST step in runSideEffects (after all other steps)', async () => {
    const src = await readFile(path.resolve('src/agent/side-effects.ts'), 'utf8');
    // C7 — Memory consolidation cycle. Locate it after C5/C6 markers.
    const c1 = src.indexOf('// C1.');
    const c2 = src.indexOf('// C2.');
    const c5 = src.indexOf('// C5.');
    const c7 = src.indexOf('// C7.');
    expect(c1).toBeGreaterThan(0);
    expect(c2).toBeGreaterThan(c1);
    expect(c5).toBeGreaterThan(c2);
    expect(c7).toBeGreaterThan(c5);
    // The memory.cycle call appears AFTER the C7 comment.
    const cycleCallIdx = src.indexOf('args.memory.cycle()');
    expect(cycleCallIdx).toBeGreaterThan(c7);
  });

  test('cycle.ts does NOT call memory.cycle() directly (only side-effects does)', async () => {
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    // The cycle protocol delegates to runSideEffects; memory.cycle() should not be called in cycle.ts.
    expect(src).not.toMatch(/memory\.cycle\(\)/);
  });
});
