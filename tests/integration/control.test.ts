import { describe, it, expect } from 'vitest';
import { Store } from '../../src/shared/db.js';
import { OpenRouterClient } from '../../src/shared/openrouter.js';
import { runControl } from '../../src/control/index.js';

function mkClient(store: Store, fetchImpl: typeof fetch, capUsd = 100): OpenRouterClient {
  return new OpenRouterClient({ apiKey: 'k', budgetCapUsd: capUsd, kind: 'control', store, fetchImpl });
}

function fixedFetch(text: string): typeof fetch {
  return (async () => ({
    ok: true, status: 200, text: async () => '',
    json: async () => ({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    }),
  } as Response)) as unknown as typeof fetch;
}

describe('control runner — integration', () => {
  it('runs N cycles, persists each, sums spend', async () => {
    const store = new Store(':memory:');
    const client = mkClient(store, fixedFetch('{"action":"none","payload":null,"thought":"observing"}'));
    const r = await runControl({
      store, apiKey: 'k', budgetCapUsd: 100, maxCycles: 5,
      intervalSeconds: 0, promptSeed: 'choose', sleepImpl: async () => {}, client,
    });
    expect(r.cyclesRun).toBe(5);
    expect(r.reason).toBe('maxCycles');
    expect(r.totalSpentUsd).toBeGreaterThan(0);
    expect(store.cyclesFor('control')).toHaveLength(5);
    expect(store.cyclesFor('control').every(c => c.status === 'complete')).toBe(true);
    store.close();
  });

  it('terminates early when agent emits action=terminate', async () => {
    const store = new Store(':memory:');
    let calls = 0;
    const f = (async () => {
      calls++;
      const text = calls === 3
        ? '{"action":"terminate","payload":null,"thought":"done"}'
        : '{"action":"none","payload":null,"thought":"observing"}';
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const client = mkClient(store, f);
    const r = await runControl({
      store, apiKey: 'k', budgetCapUsd: 100, maxCycles: 100,
      intervalSeconds: 0, promptSeed: 'choose', sleepImpl: async () => {}, client,
    });
    expect(r.reason).toBe('terminated');
    expect(r.cyclesRun).toBe(3);
    store.close();
  });

  it('stops on BudgetExceededError', async () => {
    const store = new Store(':memory:');
    // Pre-spend == cap so first call's budgetStatus check sees `exhausted`.
    const seed = store.startCycle('control', -1);
    store.recordDecision({
      kind: 'control', cycleId: seed.id, role: 'naive', model: 'm', prompt: 'p', output: 'o',
      costUsd: 1.0, promptTokens: 0, completionTokens: 0, createdAt: new Date().toISOString(),
    });
    store.completeCycle(seed.id, 'complete');
    const client = mkClient(store, fixedFetch('{"action":"none"}'), 1);
    const r = await runControl({
      store, apiKey: 'k', budgetCapUsd: 1, maxCycles: 100,
      intervalSeconds: 0, promptSeed: 'choose', sleepImpl: async () => {}, client,
    });
    expect(r.reason).toBe('budgetExhausted');
    expect(r.cyclesRun).toBe(0);
    store.close();
  });
});
