// T131 [US8] — Bearer-token middleware (FR-132) timing-safe + correct status codes.

import { describe, expect, test } from 'vitest';
import { extractBearerToken, requireBearerToken } from '../../src/dashboard/auth.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; statusCode: number; body: string; headers: Record<string, string> } {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    end: (b?: string) => {
      body = b ?? '';
    },
    get statusCode(): number {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
  } as unknown as ServerResponse;
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

describe('extractBearerToken', () => {
  test('returns token when Authorization: Bearer ... is present', () => {
    expect(extractBearerToken(mockReq({ authorization: 'Bearer secret123' }))).toBe('secret123');
  });

  test('returns null when no Authorization header', () => {
    expect(extractBearerToken(mockReq({}))).toBeNull();
  });

  test('returns null when scheme is not Bearer', () => {
    expect(extractBearerToken(mockReq({ authorization: 'Basic abc=' }))).toBeNull();
  });
});

describe('requireBearerToken', () => {
  test('401 when no token', async () => {
    const wrapped = requireBearerToken('topsecret', () => {
      throw new Error('handler should not run');
    });
    const r = mockRes();
    await wrapped(mockReq({}), r.res);
    expect(r.statusCode).toBe(401);
    const parsed = JSON.parse(r.body) as { code: string };
    expect(parsed.code).toBe('unauthorized');
  });

  test('401 when wrong token', async () => {
    const wrapped = requireBearerToken('topsecret', () => {
      throw new Error('handler should not run');
    });
    const r = mockRes();
    await wrapped(mockReq({ authorization: 'Bearer wrong' }), r.res);
    expect(r.statusCode).toBe(401);
  });

  test('passes through when token matches', async () => {
    let called = false;
    const wrapped = requireBearerToken('topsecret', () => {
      called = true;
    });
    const r = mockRes();
    await wrapped(mockReq({ authorization: 'Bearer topsecret' }), r.res);
    expect(called).toBe(true);
  });
});
