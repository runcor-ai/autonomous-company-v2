// Bearer-token middleware for operator endpoints (T080, FR-132).
//
// `requireBearerToken` wraps an HTTP handler. Returns 401 with `{ error, code: 'unauthorized' }`
// when the bearer token is missing or doesn't match the configured operator token (constant-time
// comparison via timingSafeEqual to avoid token leakage via timing).

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || !m[1]) return null;
  return m[1].trim();
}

export function requireBearerToken(operatorToken: string, handler: RequestHandler): RequestHandler {
  return async (req, res) => {
    const token = extractBearerToken(req);
    if (!token || !constantTimeEqual(token, operatorToken)) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Bearer token required', code: 'unauthorized' }));
      return;
    }
    await handler(req, res);
  };
}
