// Agent egress filter (T081, FR-134).
//
// `/scores` MUST 403 when the request originates from the agent process even with a valid
// bearer token (Principle IX — no experimenter contamination). The agent doesn't have the
// bearer token in this codebase, but defense-in-depth: if a future bug or misconfiguration
// exposed it, the egress filter still keeps `/scores` invisible to the agent.
//
// Implementation: V2 sets `AGENT_EGRESS_IPS` env var to the comma-separated list of IPs
// the agent process can egress from (typically the Railway service's IP). Requests whose
// `req.socket.remoteAddress` matches any are 403'd.

import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from './auth.js';

function readAgentEgressIps(): string[] {
  const raw = process.env.AGENT_EGRESS_IPS;
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw.split(',').map((x) => x.trim()).filter(Boolean);
}

export function isAgentEgress(req: IncomingMessage, agentEgressIps: string[]): boolean {
  if (agentEgressIps.length === 0) return false;
  const remote = req.socket.remoteAddress;
  if (typeof remote !== 'string') return false;
  // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4) → 1.2.3.4
  const normalized = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  return agentEgressIps.includes(normalized) || agentEgressIps.includes(remote);
}

export function blockAgentEgress(handler: RequestHandler): RequestHandler {
  const ips = readAgentEgressIps();
  return async (req, res) => {
    if (isAgentEgress(req, ips)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Forbidden — agent egress', code: 'forbidden_egress' }));
      return;
    }
    await handler(req, res);
  };
}
