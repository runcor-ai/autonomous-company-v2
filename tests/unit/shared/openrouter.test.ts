import { describe, it, expect } from 'vitest';
import { Store } from '../../../src/shared/db.js';
import { BudgetExceededError, OpenRouterClient } from '../../../src/shared/openrouter.js';

function mockFetch(response: { promptTokens: number; completionTokens: number; text: string }): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: response.text } }],
      usage: {
        prompt_tokens: response.promptTokens,
        completion_tokens: response.completionTokens,
        total_tokens: response.promptTokens + response.completionTokens,
      },
    }),
  } as Response)) as unknown as typeof fetch;
}

describe('OpenRouterClient — cost tracking', () => {
  it('records a decision with correct cost based on model price', async () => {
    const store = new Store(':memory:');
    const c = store.startCycle('v2', 0);
    const client = new OpenRouterClient({
      apiKey: 'k', budgetCapUsd: 10, kind: 'v2', store,
      fetchImpl: mockFetch({ promptTokens: 1_000_000, completionTokens: 1_000_000, text: 'hello' }),
    });
    const r = await client.complete({ role: 'player', prompt: 'hi', cycleId: c.id });
    // Player default: prompt $0.35/Mtok + completion $0.40/Mtok = $0.75
    expect(r.costUsd).toBeCloseTo(0.75, 4);
    expect(r.text).toBe('hello');
    expect(store.totalSpentUsd('v2')).toBeCloseTo(0.75, 4);
    store.close();
  });
});

describe('OpenRouterClient — budget enforcement', () => {
  it('throws BudgetExceededError when spent >= cap', async () => {
    const store = new Store(':memory:');
    const c = store.startCycle('v2', 0);
    // Pre-spend by recording a decision directly that exceeds cap.
    store.recordDecision({
      kind: 'v2', cycleId: c.id, role: 'player', model: 'm', prompt: 'p', output: 'o',
      costUsd: 5.0, promptTokens: 0, completionTokens: 0, createdAt: new Date().toISOString(),
    });
    const client = new OpenRouterClient({
      apiKey: 'k', budgetCapUsd: 4, kind: 'v2', store,
      fetchImpl: mockFetch({ promptTokens: 100, completionTokens: 50, text: 'x' }),
    });
    await expect(client.complete({ role: 'player', prompt: 'y', cycleId: c.id })).rejects.toBeInstanceOf(BudgetExceededError);
    store.close();
  });

  it('budgetStatus reports correctly', () => {
    const store = new Store(':memory:');
    const c = store.startCycle('control', 0);
    store.recordDecision({
      kind: 'control', cycleId: c.id, role: 'naive', model: 'm', prompt: 'p', output: 'o',
      costUsd: 0.25, promptTokens: 0, completionTokens: 0, createdAt: new Date().toISOString(),
    });
    const client = new OpenRouterClient({
      apiKey: 'k', budgetCapUsd: 1, kind: 'control', store,
      fetchImpl: mockFetch({ promptTokens: 0, completionTokens: 0, text: '' }),
    });
    const s = client.budgetStatus();
    expect(s.spentUsd).toBeCloseTo(0.25, 4);
    expect(s.remainingUsd).toBeCloseTo(0.75, 4);
    expect(s.exhausted).toBe(false);
    store.close();
  });
});
