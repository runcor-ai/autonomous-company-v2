import { describe, it, expect } from 'vitest';
import { Store } from '../../src/shared/db.js';
import { OpenRouterClient } from '../../src/shared/openrouter.js';
import { runAgent } from '../../src/agent/index.js';
import { bootHarness, closeHarness, type DialecticLike } from '../../src/agent/boot.js';
import { runAgentCycle } from '../../src/agent/cycle.js';

/** Mock dialectic that returns a fixed JSON action wrapped in surrounding text. */
function mockDialectic(action = 'none', payload: unknown = null, thought = 'observing'): DialecticLike {
  return async () => ({
    answer: `Reasoning... {"action":"${action}","payload":${JSON.stringify(payload)},"thought":"${thought}"} more text.`,
  });
}

function dummyOpenRouter(store: Store): OpenRouterClient {
  return new OpenRouterClient({
    apiKey: 'k', budgetCapUsd: 100, kind: 'v2', store,
    fetchImpl: (async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }) } as Response)) as unknown as typeof fetch,
  });
}

describe('Phase 3 — boot harness wires all 11 components', () => {
  it('every harness slot is defined and callable', () => {
    const h = bootHarness({ dialectic: mockDialectic() });
    expect(typeof h.drivesCompute).toBe('function');
    expect(typeof h.drivesRender).toBe('function');
    expect(h.identity).toBeDefined();
    expect(h.goals).toBeDefined();
    expect(h.temporal).toBeDefined();
    expect(h.meta).toBeDefined();
    expect(h.watchdog).toBeDefined();
    expect(h.skills).toBeDefined();
    expect(h.coherence).toBeDefined();
    expect(typeof h.rppParse).toBe('function');
    expect(typeof h.rppValidate).toBe('function');
    expect(typeof h.dialectic).toBe('function');
    closeHarness(h);
  });

  it('drives.compute returns 4-pressure shape with summary', () => {
    const h = bootHarness({ dialectic: mockDialectic() });
    const p = h.drivesCompute({
      resource: { budgetRemainingUsd: 50, burnPerCycleUsd: 0.5 },
    });
    expect(p.summary.length).toBeGreaterThan(0);
    expect(p.maxIntensity).toBeGreaterThanOrEqual(0);
    expect(p.maxIntensity).toBeLessThanOrEqual(1);
    closeHarness(h);
  });

  it('coherence.submit accepts a contract + returns a task id', () => {
    const h = bootHarness({ dialectic: mockDialectic() });
    const id = h.coherence.submit({
      contract: '#> spec\nGoal: smoke',
      inputs: { x: 1 },
    });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
    closeHarness(h);
  });
});

describe('Phase 3 — cycle runs through harness end-to-end', () => {
  it('persists cycle row, decision, action, and registers a coherence task', async () => {
    const store = new Store(':memory:');
    const openrouter = dummyOpenRouter(store);
    const harness = bootHarness({ dialectic: mockDialectic('http_fetch', { url: 'http://example.com' }, 'curiosity-driven probe') });
    const r = await runAgentCycle({
      store, openrouter, harness,
      cycleNumber: 0,
      budgetRemainingUsd: 100,
      burnPerCycleUsd: 0.005,
    });
    expect(r.parsedAction?.action).toBe('http_fetch');
    expect(r.coherenceTaskId).toBeGreaterThan(0);
    expect(r.watchdogFindings).toBeGreaterThanOrEqual(0);
    expect(store.cyclesFor('v2')).toHaveLength(1);
    expect(store.cyclesFor('v2')[0]?.status).toBe('complete');
    expect(store.actionsFor(r.cycleId)).toHaveLength(1);
    closeHarness(harness);
    store.close();
  });

  it('5-cycle run via runAgent — each cycle invokes the harness', async () => {
    const store = new Store(':memory:');
    const r = await runAgent({
      store,
      apiKey: 'k', budgetCapUsd: 100, maxCycles: 5,
      intervalSeconds: 0,
      sleepImpl: async () => {},
      dialectic: mockDialectic('none', null, 'void cycle'),
      client: dummyOpenRouter(store),
    });
    expect(r.cyclesRun).toBe(5);
    expect(r.reason).toBe('maxCycles');
    expect(store.cyclesFor('v2').every(c => c.status === 'complete')).toBe(true);
    store.close();
  });

  it('terminates when dialectic emits action=terminate', async () => {
    const store = new Store(':memory:');
    let calls = 0;
    const d: DialecticLike = async () => {
      calls++;
      const action = calls === 2 ? 'terminate' : 'none';
      return { answer: `{"action":"${action}","payload":null,"thought":"end"}` };
    };
    const r = await runAgent({
      store,
      apiKey: 'k', budgetCapUsd: 100, maxCycles: 100,
      intervalSeconds: 0,
      sleepImpl: async () => {},
      dialectic: d,
      client: dummyOpenRouter(store),
    });
    expect(r.reason).toBe('terminated');
    expect(r.cyclesRun).toBe(2);
    store.close();
  });

  it('passes goals + identity blocks into the cycle prompt', async () => {
    const store = new Store(':memory:');
    let capturedPrompt = '';
    const d: DialecticLike = async ({ problem }) => {
      capturedPrompt = problem;
      return { answer: '{"action":"none","payload":null}' };
    };
    const harness = bootHarness({ dialectic: d });
    // Seed a goal so its block has content.
    harness.goals.accept(
      { text: 'discover what is worth attending to', level: 'purpose', satisfactionCondition: 'attention is grounded in evidence' },
      { currentCycle: 0 },
    );
    await runAgentCycle({
      store, openrouter: dummyOpenRouter(store), harness,
      cycleNumber: 0, budgetRemainingUsd: 100, burnPerCycleUsd: 0.005,
    });
    expect(capturedPrompt).toContain('LAWS');
    expect(capturedPrompt).toContain('DRIVE PRESSURES');
    expect(capturedPrompt).toContain('IDENTITY');
    expect(capturedPrompt).toContain('GOALS');
    expect(capturedPrompt).toContain('discover what is worth attending to');
    expect(capturedPrompt).toContain('CAPABILITY USAGE');
    expect(capturedPrompt).toContain('http_fetch');
    expect(capturedPrompt).toContain('web_scrape');
    expect(capturedPrompt).toContain('fetch_chunk');
    expect(capturedPrompt).toContain('terminate');
    closeHarness(harness);
    store.close();
  });
});
