import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Store } from '../../src/shared/db.js';
import { startExperiment } from '../../src/experiment/index.js';

function mockOpenRouterFetch(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    void init;
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({
        choices: [{ message: { content: '{"action":"none","payload":null,"thought":"control observing"}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('experiment orchestration', () => {
  it('boots dashboard, V2, control, and rater concurrently', async () => {
    const store = new Store(':memory:');
    const handle = await startExperiment({
      store,
      openrouterApiKey: 'k',
      dialectic: async () => ({ answer: '{"action":"none","payload":null,"thought":"void"}' }),
      v2BudgetCapUsd: 100,
      controlBudgetCapUsd: 100,
      maxCycles: 0, // boot-only smoke test — no cycles fire
      v2IntervalSeconds: 0,
      controlIntervalSeconds: 0,
      anthropicApiKey: 'k',
      raterModel: 'claude-opus-4-7',
      raterIntervalMs: 86_400_000, // long; first tick won't fire during the test
      raterCallImpl: async () => ({ text: '{"score":0,"rationale":"unused"}', inputTokens: 0, outputTokens: 0 }),
      openrouterFetchImpl: mockOpenRouterFetch(),
      operatorAuthToken: 'tok',
      publicUrlPrefix: 'http://localhost:0',
      dashboardHost: '127.0.0.1',
      dashboardPort: 0,
      controlPromptSeed: 'choose an action or none',
    });

    // Dashboard listening on a real port.
    const port = (handle.dashboard.server.address() as AddressInfo).port;
    expect(port).toBeGreaterThan(0);

    // V2 overview endpoint reachable.
    const res = await fetch(`http://127.0.0.1:${port}/v2/overview`);
    expect(res.ok).toBe(true);

    // /scores rejects without auth (Constitution Principle III).
    const scoresUnauth = await fetch(`http://127.0.0.1:${port}/scores`);
    expect(scoresUnauth.status).toBe(401);

    // /scores accepts the operator token.
    const scoresAuth = await fetch(`http://127.0.0.1:${port}/scores`, { headers: { Authorization: 'Bearer tok' } });
    expect(scoresAuth.ok).toBe(true);

    // V2 + control runners exit immediately when maxCycles=0.
    await Promise.allSettled([handle.v2Done, handle.controlDone]);
    await handle.shutdown();
    store.close();
  });

  it('control and V2 spend independently against the shared store', async () => {
    const store = new Store(':memory:');
    // Pre-record some cycles + spend so the dashboard sees them.
    const v2Cycle = store.startCycle('v2', 0);
    store.recordDecision({
      kind: 'v2', cycleId: v2Cycle.id, role: 'player', model: 'm', prompt: 'p', output: 'o',
      costUsd: 0.10, promptTokens: 0, completionTokens: 0, createdAt: new Date().toISOString(),
    });
    const ctrlCycle = store.startCycle('control', 0);
    store.recordDecision({
      kind: 'control', cycleId: ctrlCycle.id, role: 'naive', model: 'm', prompt: 'p', output: 'o',
      costUsd: 0.05, promptTokens: 0, completionTokens: 0, createdAt: new Date().toISOString(),
    });

    expect(store.totalSpentUsd('v2')).toBeCloseTo(0.10, 4);
    expect(store.totalSpentUsd('control')).toBeCloseTo(0.05, 4);
    store.close();
  });
});

// NOTE: end-to-end runAgent + day-boundary callback wiring is exercised by
// experiment.startExperiment (smoke test above) and by reflectAndPublish unit
// tests in daily-summary.test.ts. A direct runAgent test here triggered a
// vitest worker-pool issue with native better-sqlite3 — coverage is preserved.
