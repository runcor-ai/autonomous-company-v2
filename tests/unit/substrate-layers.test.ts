// T097/T101 [US3] — Prompt layer rendering invariants (per contracts/prompt-stack-layers.md).

import { describe, expect, test } from 'vitest';
import type { LayerContext } from 'runcor-substrate';
import {
  DrivesLayer,
  GoalsLayer,
  IdentityLayer,
  CapabilitiesLayer,
  MemoryRecallLayer,
  V2RealityLayer,
} from '../../src/substrate-layers/index.js';

const baseContext: LayerContext = {
  cycle: 0,
  agentRole: 'v2',
  baseRequest: { prompt: '' },
  drives: { resource: 0.1, curiosity: 0.0, reactivity: 0.0, coherence: 0.0 },
  topGoal: null,
  identitySelfTheory: null,
  lastPlanPrecis: null,
  recalledNodes: [],
  realitySlice: null,
  capabilityList: [],
};

describe('DrivesLayer', () => {
  test('always non-empty (FR-001)', () => {
    const out = new DrivesLayer().render(baseContext);
    expect(out).toBeTruthy();
    expect(out).toContain('Drives:');
    expect(out).toContain('resource:');
  });
});

describe('GoalsLayer', () => {
  test('empty when topGoal is null (FR-001 cycle-0 contract)', () => {
    expect(new GoalsLayer().render(baseContext)).toBeNull();
  });

  test('renders top goal when present', () => {
    const out = new GoalsLayer().render({ ...baseContext, topGoal: { text: 'understand x', category: 'goal:purpose' } });
    expect(out).toContain('understand x');
  });
});

describe('IdentityLayer', () => {
  test('empty when no self-theory yet (FR-001)', () => {
    expect(new IdentityLayer().render(baseContext)).toBeNull();
  });

  test('renders self-theory when present', () => {
    const out = new IdentityLayer().render({ ...baseContext, identitySelfTheory: 'I am curious.' });
    expect(out).toContain('I am curious.');
  });
});

describe('CapabilitiesLayer', () => {
  test('non-empty even when capability list empty (always renders header)', () => {
    const out = new CapabilitiesLayer().render(baseContext);
    expect(out).toContain('Capabilities');
  });

  test('lists tools with name + description', () => {
    const out = new CapabilitiesLayer().render({
      ...baseContext,
      capabilityList: [{ name: 'v2-local-actions.web_search', description: 'Search the web' }],
    });
    expect(out).toContain('v2-local-actions.web_search');
    expect(out).toContain('Search the web');
  });
});

describe('MemoryRecallLayer (FR-076b empty contract)', () => {
  test('empty when topGoal AND lastPlanPrecis both null (cycle-0 contract)', () => {
    const out = new MemoryRecallLayer().render(baseContext);
    expect(out).toBeNull();
  });

  test('empty when only one of goals/plan present but recalledNodes empty', () => {
    const out = new MemoryRecallLayer().render({
      ...baseContext,
      topGoal: { text: 'x' },
      recalledNodes: [],
    });
    expect(out).toBeNull();
  });

  test('renders when goals + recalledNodes both present', () => {
    const out = new MemoryRecallLayer().render({
      ...baseContext,
      topGoal: { text: 'x' },
      recalledNodes: [{ id: 'n1', content: 'memory text', M: 0.85, tags: ['daily_summary'], created_cycle: 5 }],
    });
    expect(out).toContain('Recently relevant');
    expect(out).toContain('memory text');
    expect(out).toContain('M=0.85');
  });
});

describe('V2RealityLayer', () => {
  test('empty when realitySlice is null', () => {
    expect(new V2RealityLayer().render(baseContext)).toBeNull();
  });

  test('empty when entities array is empty', () => {
    const out = new V2RealityLayer().render({
      ...baseContext,
      realitySlice: { entities: [], edges: [], conflicts: [], last_updated: '' } as unknown as LayerContext['realitySlice'],
    });
    expect(out).toBeNull();
  });

  test('uses pre-rendered text from runcor-data when present', () => {
    const slice = { entities: [{ id: 'e1' }], rendered: 'Reality: 1 entity learned.' };
    const out = new V2RealityLayer().render({ ...baseContext, realitySlice: slice as unknown as LayerContext['realitySlice'] });
    expect(out).toBe('Reality: 1 entity learned.');
  });
});
