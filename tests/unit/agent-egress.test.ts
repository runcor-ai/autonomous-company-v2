// T132 [US8] — agent-egress filter (FR-134).

import { describe, expect, test } from 'vitest';
import { isAgentEgress } from '../../src/dashboard/agent-egress.js';
import type { IncomingMessage } from 'node:http';

function mockReq(remote: string): IncomingMessage {
  return { socket: { remoteAddress: remote } } as unknown as IncomingMessage;
}

describe('isAgentEgress', () => {
  test('returns false when egress list is empty', () => {
    expect(isAgentEgress(mockReq('1.2.3.4'), [])).toBe(false);
  });

  test('matches direct IP', () => {
    expect(isAgentEgress(mockReq('1.2.3.4'), ['1.2.3.4'])).toBe(true);
  });

  test('matches IPv6-mapped IPv4', () => {
    expect(isAgentEgress(mockReq('::ffff:1.2.3.4'), ['1.2.3.4'])).toBe(true);
  });

  test('returns false when no match', () => {
    expect(isAgentEgress(mockReq('5.6.7.8'), ['1.2.3.4'])).toBe(false);
  });
});
