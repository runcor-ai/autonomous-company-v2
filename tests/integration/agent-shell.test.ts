import { describe, it, expect } from 'vitest';
import { Store } from '../../src/shared/db.js';
import { OpenRouterClient } from '../../src/shared/openrouter.js';
import { runAgent } from '../../src/agent/index.js';
import { runAgentCycle } from '../../src/agent/cycle.js';
import { bootHarness } from '../../src/agent/boot.js';

function fixedFetch(text: string): typeof fetch {
  return (async () => ({
    ok: true, status: 200, text: async () => '',
    json: async () => ({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
  } as Response)) as unknown as typeof fetch;
}

function mkV2Client(store: Store, fetchImpl: typeof fetch, capUsd = 100): OpenRouterClient {
  return new OpenRouterClient({ apiKey: 'k', budgetCapUsd: capUsd, kind: 'v2', store, fetchImpl });
}

describe('agent shell — integration', () => {
  it('boots harness with all 14 stub slots', () => {
    const store = new Store(':memory:');
    const h = bootHarness(store);
    expect(Object.keys(h).sort()).toEqual([
      'coherence','data','dialectic','drives','goals','identity','integration',
      'memory','meta','rppParser','skills','substrate','temporal','watchdog',
    ]);
    store.close();
  });

  it('cycle persists v2 cycle row, calls Player, parses action', async () => {
    const store = new Store(':memory:');
    const client = mkV2Client(store, fixedFetch('Some thinking. {"action":"none","payload":null,"thought":"void cycle 0"} more text'));
    const harness = bootHarness(store);
    const r = await runAgentCycle({ store, openrouter: client, harness, prompt: 'void', cycleNumber: 0 });
    expect(r.parsedAction?.action).toBe('none');
    expect(r.parsedAction?.thought).toBe('void cycle 0');
    expect(store.cyclesFor('v2')).toHaveLength(1);
    expect(store.cyclesFor('v2')[0]?.status).toBe('complete');
    expect(store.totalSpentUsd('v2')).toBeGreaterThan(0);
    store.close();
  });

  it('runAgent runs 5 cycles independently of any control state', async () => {
    const store = new Store(':memory:');
    const client = mkV2Client(store, fixedFetch('{"action":"none","payload":null}'));
    const r = await runAgent({
      store, apiKey: 'k', budgetCapUsd: 100, maxCycles: 5,
      intervalSeconds: 0, promptSeed: 'void', sleepImpl: async () => {}, client,
    });
    expect(r.cyclesRun).toBe(5);
    expect(r.reason).toBe('maxCycles');
    expect(r.totalSpentUsd).toBeGreaterThan(0);
    store.close();
  });

  it('agent terminates when action=terminate emitted', async () => {
    const store = new Store(':memory:');
    let calls = 0;
    const f = (async () => {
      calls++;
      const text = calls === 2
        ? '{"action":"terminate","payload":null,"thought":"void produces nothing"}'
        : '{"action":"none","payload":null}';
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({
          choices: [{ message: { content: text } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const client = mkV2Client(store, f);
    const r = await runAgent({
      store, apiKey: 'k', budgetCapUsd: 100, maxCycles: 100,
      intervalSeconds: 0, promptSeed: 'void', sleepImpl: async () => {}, client,
    });
    expect(r.reason).toBe('terminated');
    expect(r.cyclesRun).toBe(2);
    store.close();
  });

  it('v2 and control budgets accumulate independently in the same store', async () => {
    const store = new Store(':memory:');
    const v2Client = mkV2Client(store, fixedFetch('{"action":"none"}'));
    await runAgent({
      store, apiKey: 'k', budgetCapUsd: 100, maxCycles: 3,
      intervalSeconds: 0, promptSeed: 'void', sleepImpl: async () => {}, client: v2Client,
    });
    const v2Spent = store.totalSpentUsd('v2');
    const controlSpent = store.totalSpentUsd('control');
    expect(v2Spent).toBeGreaterThan(0);
    expect(controlSpent).toBe(0);
    store.close();
  });
});
