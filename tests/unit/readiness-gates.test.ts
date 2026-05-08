// Readiness gates on goals.propose() + identity.reflect() — both are SKIPPED when the
// data cube has fewer than a threshold of world-anchored entities. Locks the design
// against silent drift: cognitive synthesis from a void produced the cycle-1631
// self-isolating identity in the live 2026-05-07 run. The fix is to gate, not to
// rationalize.

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SIDE_EFFECTS = path.resolve('src/agent/side-effects.ts');

let src: string;
async function load(): Promise<string> {
  if (!src) src = await readFile(SIDE_EFFECTS, 'utf8');
  return src;
}

describe('side-effects readiness gates', () => {
  test('declares MIN_DATA_ENTITIES thresholds for both gates', async () => {
    const s = await load();
    expect(s).toMatch(/MIN_DATA_ENTITIES_FOR_GOAL_PROPOSE\s*=\s*\d+/);
    expect(s).toMatch(/MIN_DATA_ENTITIES_FOR_IDENTITY_REFLECT\s*=\s*\d+/);
  });

  test('reads entity count via dataCube.getStats() before either gate', async () => {
    const s = await load();
    expect(s).toMatch(/dataEntityCount/);
    expect(s).toMatch(/args\.dataCube\.getStats\(\)\.entities/);
    // The stat read must happen BEFORE both gate decisions.
    const statIdx = s.indexOf('dataEntityCount');
    const goalsGuardIdx = s.indexOf('goalsReadyToPropose');
    const identityGuardIdx = s.indexOf('identityReadyToReflect');
    expect(statIdx).toBeGreaterThan(0);
    expect(goalsGuardIdx).toBeGreaterThan(statIdx);
    expect(identityGuardIdx).toBeGreaterThan(statIdx);
  });

  test('goals.propose() is gated by dataEntityCount >= threshold', async () => {
    const s = await load();
    // The propose() call must be inside an `if (... && goalsReadyToPropose)` block.
    const proposeIdx = s.indexOf('args.goals.propose(');
    expect(proposeIdx).toBeGreaterThan(0);
    const before = s.slice(0, proposeIdx);
    expect(before).toMatch(/goalsReadyToPropose\s*=\s*dataEntityCount\s*>=\s*MIN_DATA_ENTITIES_FOR_GOAL_PROPOSE/);
    expect(before).toMatch(/&&\s*goalsReadyToPropose/);
  });

  test('identity.reflect() is gated by dataEntityCount >= threshold', async () => {
    const s = await load();
    const reflectIdx = s.indexOf('args.identity.reflect(');
    expect(reflectIdx).toBeGreaterThan(0);
    const before = s.slice(0, reflectIdx);
    expect(before).toMatch(/identityReadyToReflect\s*=\s*dataEntityCount\s*>=\s*MIN_DATA_ENTITIES_FOR_IDENTITY_REFLECT/);
    expect(before).toMatch(/&&\s*identityReadyToReflect/);
  });

  test('identity threshold is at least as strict as goals threshold', async () => {
    const s = await load();
    // Identity reflection is heavier (changes self-theory); should require at least as much
    // grounding as a goal proposal. Prevents future drift where someone tunes goals tighter
    // than identity and unbalances the gates.
    const goalMatch = s.match(/MIN_DATA_ENTITIES_FOR_GOAL_PROPOSE\s*=\s*(\d+)/);
    const idMatch = s.match(/MIN_DATA_ENTITIES_FOR_IDENTITY_REFLECT\s*=\s*(\d+)/);
    expect(goalMatch).not.toBeNull();
    expect(idMatch).not.toBeNull();
    const goal = parseInt(goalMatch![1]!, 10);
    const id = parseInt(idMatch![1]!, 10);
    expect(id).toBeGreaterThanOrEqual(goal);
  });
});
