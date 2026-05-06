// T048 — rater port unit test against in-memory rater.db + mocked OpenRouter call.

import { describe, expect, test, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RaterStore } from '../../src/rater/store.js';
import { scoreOne } from '../../src/rater/index.js';
import type { OpenRouterCallArgs, OpenRouterResponse } from '../../src/rater/openrouter.js';

let dir: string;
let store: RaterStore;
afterEach(() => {
  if (store) store.close();
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function makeStore(): RaterStore {
  dir = mkdtempSync(path.join(tmpdir(), 'rater-'));
  store = new RaterStore(path.join(dir, 'rater.db'));
  return store;
}

function fakeNode(opts: { id?: string; tags?: string[]; content?: string } = {}): {
  id: string; content: string; tags: string[]; M: number; R: number; f: number; t: number; D: number; cube: 'short' | 'long'; lastAccessed: number;
} {
  return {
    id: opts.id ?? 'node-1',
    content: opts.content ?? 'today V2 reflected on understanding deepfakes',
    tags: opts.tags ?? ['daily_summary', 'day:1'],
    M: 0.5,
    R: 0.7,
    f: 1,
    t: 0,
    D: 1,
    cube: 'short',
    lastAccessed: 0,
  };
}

describe('RaterStore', () => {
  test('addScore + hasScore + list round-trip', () => {
    const s = makeStore();
    expect(s.hasScore('node-1')).toBe(false);
    const inserted = s.addScore({
      summaryNodeId: 'node-1',
      kind: 'v2',
      dayNumber: 1,
      score: 0.6,
      rationale: 'truth-seeking',
      model: 'anthropic/claude-3.5-sonnet',
    });
    expect(inserted.id).toBeGreaterThan(0);
    expect(s.hasScore('node-1')).toBe(true);
    const all = s.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.score).toBe(0.6);
    expect(all[0]!.kind).toBe('v2');
  });

  test('list filters by kind', () => {
    const s = makeStore();
    s.addScore({ summaryNodeId: 'a', kind: 'v2', dayNumber: 1, score: 0.5, rationale: 'r', model: 'm' });
    s.addScore({ summaryNodeId: 'b', kind: 'control', dayNumber: 1, score: -0.2, rationale: 'r', model: 'm' });
    expect(s.list({ kind: 'v2' })).toHaveLength(1);
    expect(s.list({ kind: 'control' })).toHaveLength(1);
  });
});

describe('scoreOne (rubric round-trip with mock LLM)', () => {
  test('parses {score, rationale} from model reply and persists', async () => {
    const s = makeStore();
    const node = fakeNode({ id: 'sum-1', content: 'V2 acted with integrity today' });
    const callImpl = async (_args: OpenRouterCallArgs): Promise<OpenRouterResponse> => ({
      text: '{"score": 0.7, "rationale": "Genuine integrity in stated intent"}',
      model: 'anthropic/claude-3.5-sonnet',
    });
    const result = await scoreOne(node, 'v2', {
      apiKey: 'unused',
      model: 'anthropic/claude-3.5-sonnet',
      store: s,
      callImpl,
    });
    expect(result.score).toBe(0.7);
    expect(result.rationale).toMatch(/integrity/i);
    expect(s.hasScore('sum-1')).toBe(true);
  });

  test('throws when reply has no score JSON', async () => {
    const s = makeStore();
    const callImpl = async (_args: OpenRouterCallArgs): Promise<OpenRouterResponse> => ({
      text: 'no JSON here',
      model: 'anthropic/claude-3.5-sonnet',
    });
    await expect(
      scoreOne(fakeNode(), 'v2', {
        apiKey: 'unused',
        model: 'anthropic/claude-3.5-sonnet',
        store: s,
        callImpl,
      }),
    ).rejects.toThrow(/JSON score object/);
  });

  test('rejects out-of-range scores', async () => {
    const s = makeStore();
    const callImpl = async (_args: OpenRouterCallArgs): Promise<OpenRouterResponse> => ({
      text: '{"score": 5, "rationale": "x"}',
      model: 'm',
    });
    await expect(
      scoreOne(fakeNode(), 'v2', { apiKey: 'k', model: 'm', store: s, callImpl }),
    ).rejects.toThrow(/score must be number in/);
  });
});
