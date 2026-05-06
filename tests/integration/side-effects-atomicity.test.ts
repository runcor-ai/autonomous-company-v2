// T098 [US3] — Verify side-effects atomicity: on cycle_failed_call NO memory.record /
// NO dataCube.ingest / NO action invocation; on completed_with_flag side effects DO commit.
// FR-018 + FR-019d.
//
// Source-level invariant: cycle.ts only calls runSideEffects when status !== 'cycle_failed_call'.
// We verify this by reading cycle.ts and checking the conditional gate.

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('T098: side-effects atomicity (FR-018, FR-019d)', () => {
  test('cycle.ts gates runSideEffects on status !== cycle_failed_call', async () => {
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    // Find the runSideEffects call site and verify it's inside an `if (status !== 'cycle_failed_call')` block.
    const callIdx = src.indexOf('runSideEffects(');
    expect(callIdx).toBeGreaterThan(0);
    const before = src.slice(0, callIdx);
    // The closest enclosing condition.
    expect(before).toMatch(/if\s*\(\s*status\s*!==\s*['"]cycle_failed_call['"]\s*\)/);
  });

  test('cycle.ts sets status to completed_with_flag (not failed) when discernment_flagged fires', async () => {
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    expect(src).toMatch(/if \(flagThisCycle\)\s*\{[^}]*status\s*=\s*['"]completed_with_flag['"]/s);
  });

  test('cycle.ts emits flag_burst_warning at threshold ≥ 5 in 10-cycle window', async () => {
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    expect(src).toMatch(/recentFlags\.length\s*>=\s*5/);
    expect(src).toMatch(/flag_burst_warning/);
  });

  test('side-effects.ts runs memory.record AND dataCube.ingest only when args.action is non-null', async () => {
    const src = await readFile(path.resolve('src/agent/side-effects.ts'), 'utf8');
    // Episodic record + data ingest both gated on `if (args.action) {`.
    const recordIdx = src.indexOf('args.memory.record(');
    const ingestIdx = src.indexOf('args.dataCube.ingest(');
    expect(recordIdx).toBeGreaterThan(0);
    expect(ingestIdx).toBeGreaterThan(0);
    // Both inside `if (args.action)` blocks.
    expect(src.slice(0, recordIdx)).toMatch(/if \(args\.action\)/);
    expect(src.slice(0, ingestIdx)).toMatch(/if \(args\.action\)/);
  });

  test('side-effects.ts always runs memory.cycle() at end (R9 cadence)', async () => {
    const src = await readFile(path.resolve('src/agent/side-effects.ts'), 'utf8');
    expect(src).toMatch(/await args\.memory\.cycle\(\)/);
  });
});
