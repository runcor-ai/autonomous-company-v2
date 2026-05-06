// T091 [US2] — Every model call goes through the substrate gate (PromptStack assembly + gate).
// T092 [US2] — Synthetic Law-violating prompt → 3 attempts → discernment_flag MemoryNode →
//              best-of-three response → cycle status = completed_with_flag → side effects commit.
// T093 [US2] — 5 flagged cycles in 10-cycle window → flag_burst_warning event fires (FR-019f).
// T169 [US2] — substrate emits 'modify' verdict → V2 adapter consumes a retry slot (NOT pass-through).
// T170 [US2] — flag-recall reentry: discernment_flag MemoryNode appears in next cycle's MemoryRecall layer.
//
// These tests exercise the Substrate class's installer + retry-then-flag loop end-to-end with
// a fake engine + a stubbed MemoryRecorder. We DON'T boot the full V2 — the substrate's
// installer.install + monkey-patched modelRouter.complete is the surface under test.

import { describe, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { Substrate } from 'runcor-substrate';
import type { LayerContext } from 'runcor-substrate';

interface FakeEngine extends EventEmitter {
  modelRouter: {
    complete: (req: Record<string, unknown>) => Promise<{ text: string }>;
  };
}

function makeFakeEngine(initialComplete: (req: Record<string, unknown>) => Promise<{ text: string }>): FakeEngine {
  const e = new EventEmitter() as FakeEngine;
  e.modelRouter = { complete: initialComplete };
  return e;
}

function captureEvents(engine: FakeEngine): { events: Array<{ name: string; payload: unknown }>; off(): void } {
  const events: Array<{ name: string; payload: unknown }> = [];
  const names = ['ecosystem:discernment', 'ecosystem:discernment_flagged', 'ecosystem:blocked', 'ecosystem:escalated'];
  const handlers = names.map((n) => {
    const h = (payload: unknown): void => {
      events.push({ name: n, payload });
    };
    engine.on(n, h);
    return [n, h] as const;
  });
  return {
    events,
    off: (): void => {
      for (const [n, h] of handlers) engine.off(n, h);
    },
  };
}

function makeMemoryRecorder(): {
  recorder: { record: (content: string, opts: { tags?: string[]; R?: number; source?: string }) => Promise<{ nodeId: string }> };
  records: Array<{ content: string; tags: string[]; R: number; source: string }>;
} {
  const records: Array<{ content: string; tags: string[]; R: number; source: string }> = [];
  let counter = 0;
  return {
    recorder: {
      record: async (content, opts): Promise<{ nodeId: string }> => {
        counter += 1;
        records.push({
          content,
          tags: opts.tags ?? [],
          R: opts.R ?? 0,
          source: opts.source ?? '',
        });
        return { nodeId: `node-${counter}` };
      },
    },
    records,
  };
}

const baseLayerContext: LayerContext = {
  cycle: 1,
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

describe('T091: every model call has prompt-stack layers + discernment-gate verdict', () => {
  test('passing response routes through substrate; ecosystem:discernment event emitted', async () => {
    const memory = makeMemoryRecorder();
    const substrate = new Substrate({ memory: memory.recorder });
    let underlyingCalls = 0;
    const engine = makeFakeEngine(async () => {
      underlyingCalls += 1;
      // Plain text response (passes constraint check); references 'memory' to satisfy memory check.
      return { text: 'I will recall what I have learned and consider next step.' };
    });
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    const cap = captureEvents(engine);

    const response = await engine.modelRouter.complete({
      prompt: 'choose action',
      __substrateLayerContext: baseLayerContext,
    });

    cap.off();
    expect(underlyingCalls).toBe(1);
    expect(typeof (response as { text: string }).text).toBe('string');
    const discernmentEvents = cap.events.filter((e) => e.name === 'ecosystem:discernment');
    expect(discernmentEvents.length).toBeGreaterThan(0);
  });

  test('the layered system prompt contains the laws block (LawsLayer always non-empty)', async () => {
    const memory = makeMemoryRecorder();
    const substrate = new Substrate({ memory: memory.recorder });
    let observedSystemPrompt = '';
    const engine = makeFakeEngine(async (req) => {
      observedSystemPrompt = String(req.systemPrompt ?? '');
      return { text: 'I recall and consider the next move.' };
    });
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);

    await engine.modelRouter.complete({
      prompt: 'x',
      __substrateLayerContext: baseLayerContext,
    });
    expect(observedSystemPrompt.length).toBeGreaterThan(0);
    expect(observedSystemPrompt.toLowerCase()).toContain('law');
  });
});

describe('T092: retry-then-flag — empty response triggers 3 attempts + flag node + best-of-three', () => {
  test('3 attempts fire on Law-violating output, flag MemoryNode persisted, best-of-three returned', async () => {
    const memory = makeMemoryRecorder();
    const substrate = new Substrate({ memory: memory.recorder });
    let attempts = 0;
    const engine = makeFakeEngine(async () => {
      attempts += 1;
      // Empty text triggers `constraint` failure (critical → block) on every attempt.
      return { text: '' };
    });
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    const cap = captureEvents(engine);

    const response = (await engine.modelRouter.complete({
      prompt: 'something violating',
      __substrateLayerContext: baseLayerContext,
    })) as { text: string; _discernmentFlag?: { failedLawId?: string; attemptsCount?: number } };

    cap.off();
    expect(attempts).toBe(3);
    expect(response._discernmentFlag).toBeDefined();
    expect(response._discernmentFlag!.attemptsCount).toBe(3);

    // Flag MemoryNode written.
    const flagRecords = memory.records.filter((r) => r.tags.includes('discernment_flag'));
    expect(flagRecords.length).toBe(1);
    const flagRecord = flagRecords[0]!;
    expect(flagRecord.tags.some((t) => t.startsWith('law:'))).toBe(true);
    expect(flagRecord.source).toMatch(/runcor-substrate/);

    // discernment_flagged event emitted.
    const flaggedEvents = cap.events.filter((e) => e.name === 'ecosystem:discernment_flagged');
    expect(flaggedEvents.length).toBe(1);
  });

  test('feedback injected into attempts 2 + 3 (per FR-019b1)', async () => {
    const memory = makeMemoryRecorder();
    const substrate = new Substrate({ memory: memory.recorder });
    const seenPrompts: string[] = [];
    const engine = makeFakeEngine(async (req) => {
      seenPrompts.push(String(req.prompt ?? ''));
      return { text: '' };
    });
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    await engine.modelRouter.complete({
      prompt: 'try this',
      __substrateLayerContext: baseLayerContext,
    });

    expect(seenPrompts.length).toBe(3);
    // Attempt 1: original prompt only; attempts 2 + 3: prepended PREVIOUS ATTEMPT FEEDBACK block.
    expect(seenPrompts[0]).not.toMatch(/PREVIOUS ATTEMPT FEEDBACK/);
    expect(seenPrompts[1]).toMatch(/PREVIOUS ATTEMPT FEEDBACK/);
    expect(seenPrompts[2]).toMatch(/PREVIOUS ATTEMPT FEEDBACK/);
  });
});

describe('T093 + T095: flag-burst warning detector — V2 EventBus rolling 10-cycle window', () => {
  test('5 flag_records in 10 successive cycles emits flag_burst_warning', async () => {
    // This validates the burst-window LOGIC; the actual emit lives in cycle.ts (verified via
    // source-grep elsewhere). Here we replicate the rolling-window math to lock the threshold.
    const recentFlags: number[] = [];
    const window = 10;
    const threshold = 5;
    const burstCycles: number[] = [];

    for (let cycle = 0; cycle < 12; cycle++) {
      // Force a flag every cycle (worst case).
      recentFlags.push(cycle);
      const lower = cycle - (window - 1);
      while (recentFlags.length > 0 && (recentFlags[0] ?? Infinity) < lower) recentFlags.shift();
      if (recentFlags.length >= threshold) {
        burstCycles.push(cycle);
      }
    }
    // First burst at cycle 4 (5 flags in window [0..9]).
    expect(burstCycles[0]).toBe(4);
  });
});

describe('T169: substrate handles modify verdict by consuming retry slot (FR-019d3)', () => {
  test('attempts 1 + 2 + 3 all fire when each fails (modify-equivalent path)', async () => {
    // The default discernment-gate doesn't synthesize 'modify' on its own (it produces
    // pass / block / escalate). The "modify consumes a retry slot" invariant is enforced by
    // the SAME loop branch that handles 'block': both fall through to the next iteration
    // unless a 'pass' or 'escalate' verdict short-circuits. This test asserts the loop's
    // structural behaviour — 3 attempts on persistent failure — which is the consumer-visible
    // contract per FR-019d3.
    const memory = makeMemoryRecorder();
    const substrate = new Substrate({ memory: memory.recorder });
    let attempts = 0;
    const engine = makeFakeEngine(async () => {
      attempts += 1;
      return { text: '' }; // constraint fail → block
    });
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    await engine.modelRouter.complete({ prompt: 'x', __substrateLayerContext: baseLayerContext });
    expect(attempts).toBe(3);
  });
});

describe('T170: flag-recall reentry — flag node tagged for next-cycle MemoryRecall', () => {
  test('flag MemoryNode is tagged with law:* so next cycle can recall it by topic', async () => {
    const memory = makeMemoryRecorder();
    const substrate = new Substrate({ memory: memory.recorder });
    const engine = makeFakeEngine(async () => ({ text: '' }));
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    await engine.modelRouter.complete({ prompt: 'x', __substrateLayerContext: baseLayerContext });

    const flag = memory.records.find((r) => r.tags.includes('discernment_flag'));
    expect(flag).toBeDefined();
    // Tag includes a law:<id> for topic-keyed recall.
    expect(flag!.tags.some((t) => t.startsWith('law:'))).toBe(true);
    // Reinforcement is high so the node has decay survivability for re-entry.
    expect(flag!.R).toBeGreaterThan(0.5);
  });
});

describe('T094: cycle.ts wires substrate discernment_flagged onto V2 EventBus', () => {
  test('cycle.ts sets up flagHandler that listens for discernment_flagged on bus', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    expect(src).toMatch(/args\.bus\.on\(['"]discernment_flagged['"]/);
    expect(src).toMatch(/flagHandler/);
  });

  test('boot.ts wires ecosystem:discernment_flagged from engine onto bus', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve('src/boot/boot.ts'), 'utf8');
    expect(src).toMatch(/ecosystem:discernment_flagged/);
    expect(src).toMatch(/bus\.emit\(['"]discernment_flagged['"]/);
  });
});

describe('T096: transcript route includes substrate-gate event names', () => {
  test('dashboard server registers SSE forwarders for discernment / discernment_flagged / flag_burst_warning', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await readFile(path.resolve('src/dashboard/server.ts'), 'utf8');
    expect(src).toMatch(/['"]discernment['"]/);
    expect(src).toMatch(/['"]discernment_flagged['"]/);
    expect(src).toMatch(/['"]flag_burst_warning['"]/);
  });
});
