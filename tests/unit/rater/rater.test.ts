import { describe, it, expect } from 'vitest';
import { Store } from '../../../src/shared/db.js';
import { scoreSummary, scoreAllUnscored } from '../../../src/rater/index.js';
import { rubricHash, RATER_SYSTEM_PROMPT } from '../../../src/rater/rubric.js';
import type { AnthropicCallInput, AnthropicCallResult } from '../../../src/rater/anthropic.js';

function mockCall(payload: { score: number; rationale: string }): typeof import('../../../src/rater/anthropic.js')['callAnthropic'] {
  return async (_: AnthropicCallInput): Promise<AnthropicCallResult> => ({
    text: `Some preamble. {"score": ${payload.score}, "rationale": "${payload.rationale.replace(/"/g, "'")}"} trailing.`,
    inputTokens: 100,
    outputTokens: 30,
  });
}

describe('rubric', () => {
  it('hash is stable for the same input', () => {
    expect(rubricHash()).toBe(rubricHash());
  });

  it('system prompt mentions [-1, +1] axis explicitly', () => {
    expect(RATER_SYSTEM_PROMPT).toContain('[-1, +1]');
    expect(RATER_SYSTEM_PROMPT).toContain('benevolent');
    expect(RATER_SYSTEM_PROMPT).toContain('harmful');
  });
});

describe('scoreSummary', () => {
  it('persists a ScoreRecord with the parsed score + rationale', async () => {
    const store = new Store(':memory:');
    const sum = store.addSummary('v2', 1, 'today I observed the void');
    const rec = await scoreSummary(sum, {
      apiKey: 'k', model: 'claude-opus-4-7', store,
      callImpl: mockCall({ score: 0.7, rationale: 'truth-seeking observation' }),
    });
    expect(rec.score).toBe(0.7);
    expect(rec.rationale).toBe('truth-seeking observation');
    expect(rec.raterModel).toBe('claude-opus-4-7');
    expect(store.allScores()).toHaveLength(1);
    store.close();
  });

  it('rejects out-of-range scores', async () => {
    const store = new Store(':memory:');
    const sum = store.addSummary('v2', 1, 'x');
    await expect(scoreSummary(sum, {
      apiKey: 'k', model: 'm', store,
      callImpl: mockCall({ score: 1.5, rationale: 'too high' }),
    })).rejects.toThrow(/score must be number in/);
    store.close();
  });

  it('rejects non-JSON model output', async () => {
    const store = new Store(':memory:');
    const sum = store.addSummary('v2', 1, 'x');
    await expect(scoreSummary(sum, {
      apiKey: 'k', model: 'm', store,
      callImpl: async () => ({ text: 'totally not json', inputTokens: 0, outputTokens: 0 }),
    })).rejects.toThrow(/did not contain a JSON score object/);
    store.close();
  });
});

describe('scoreAllUnscored', () => {
  it('scores every unscored summary; a second run is a no-op', async () => {
    const store = new Store(':memory:');
    store.addSummary('v2', 1, 'one');
    store.addSummary('v2', 2, 'two');
    store.addSummary('control', 1, 'control one');
    const cfg = {
      apiKey: 'k', model: 'm', store,
      callImpl: mockCall({ score: 0.4, rationale: 'observed' }),
    };
    const first = await scoreAllUnscored(cfg);
    expect(first).toHaveLength(3);
    const second = await scoreAllUnscored(cfg);
    expect(second).toHaveLength(0);
    expect(store.allScores()).toHaveLength(3);
    store.close();
  });
});

describe('rater via OpenRouter (callOpenRouterChat)', () => {
  it('calls /chat/completions and returns parsed text + token counts', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const f = (async (url: unknown, init?: RequestInit) => {
      captured = { url: url as string, ...(init !== undefined ? { init } : {}) };
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: '{"score":0.5,"rationale":"n/a"}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    const { callOpenRouterChat } = await import('../../../src/rater/openrouter.js');
    const r = await callOpenRouterChat({
      apiKey: 'k', model: 'anthropic/claude-3.5-sonnet',
      system: 'sys', user: 'usr',
      fetchImpl: f,
    });
    expect(captured.url).toContain('/chat/completions');
    expect((captured.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer k');
    const body = JSON.parse(captured.init!.body as string) as { messages: Array<{ role: string }> };
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(r.text).toContain('"score":0.5');
    expect(r.inputTokens).toBe(120);
    expect(r.outputTokens).toBe(40);
  });

  it('plugs into scoreSummary as a drop-in replacement for callAnthropic', async () => {
    const { callOpenRouterChat } = await import('../../../src/rater/openrouter.js');
    const f = (async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => ({
        choices: [{ message: { content: '{"score":-0.2,"rationale":"slightly off"}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
    } as Response)) as unknown as typeof fetch;
    const wrapped: typeof callOpenRouterChat = (input) => callOpenRouterChat({ ...input, fetchImpl: f });
    const store = new Store(':memory:');
    const sum = store.addSummary('v2', 1, 'a daily reflection');
    const rec = await scoreSummary(sum, {
      apiKey: 'k', model: 'anthropic/claude-3.5-sonnet', store,
      callImpl: wrapped,
    });
    expect(rec.score).toBe(-0.2);
    expect(rec.rationale).toBe('slightly off');
    store.close();
  });
});
