// T097 [US3] — Cycle response parser covers all the shapes the model returns.

import { describe, expect, test } from 'vitest';
import { parseCycleResponse } from '../../src/agent/response-parser.js';

describe('parseCycleResponse', () => {
  test('parses bare JSON', () => {
    const out = parseCycleResponse('{"action":"web_search","args":{"query":"x"},"reasoning":"r"}');
    expect(out).toEqual({ action: 'web_search', args: { query: 'x' }, reasoning: 'r' });
  });

  test('parses JSON inside ```json fences', () => {
    const text = 'I will search.\n```json\n{"action":"web_search","args":{"query":"y"},"reasoning":"r"}\n```\nDone.';
    const out = parseCycleResponse(text);
    expect(out?.action).toBe('web_search');
    expect(out?.args).toEqual({ query: 'y' });
  });

  test('parses JSON preceded by free-form text', () => {
    const text = 'Thinking about this. {"action":"fs_read","args":{"path":"a.txt"},"reasoning":"r"} ok.';
    const out = parseCycleResponse(text);
    expect(out?.action).toBe('fs_read');
  });

  test('accepts payload alias for args', () => {
    const out = parseCycleResponse('{"action":"none","payload":{"k":1},"thought":"t"}');
    expect(out).toEqual({ action: 'none', args: { k: 1 }, reasoning: 't' });
  });

  test('returns null when JSON is missing', () => {
    expect(parseCycleResponse('I cannot decide.')).toBeNull();
  });

  test('returns null when JSON has no action field', () => {
    expect(parseCycleResponse('{"foo":1,"bar":2}')).toBeNull();
  });

  test('returns null on malformed JSON', () => {
    expect(parseCycleResponse('{action: "x"}')).toBeNull();
  });
});
