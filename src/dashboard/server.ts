// V2 dashboard HTTP+SSE server (T079) — Node built-in http; no Express, no Hono.
//
// Routes are registered as a flat lookup table. Auth (bearer) and agent-egress filters wrap
// individual handlers per `contracts/dashboard-api.md`. SSE transcript stream consumes from
// the EventBus (src/dashboard/event-bus.ts).
//
// The server is started by agent/index.ts after boot completes; control/index.ts does NOT
// start its own server (control is observed through V2's dashboard via `?role=control`
// query parameters and the engine telemetry from the control process is forwarded into the
// V2 EventBus by ... actually no, control is a separate process. For V2-002 v0.1, V2 and
// control each run their own dashboard or only V2 hosts the dashboard. Operator can run
// `npm start dashboard` standalone if they want a query-only view.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { EventBus } from './event-bus.js';
import type { V2Env } from '../shared/env.js';
import type { MemorySystem } from 'runcor-memory';
import type { DataCube } from 'runcor-data';
import type { StartupRecord } from '../boot/startup-record.js';
import { OperatorStore, type OperatorActionKind } from './operator-store.js';
import { requireBearerToken, extractBearerToken, type RequestHandler } from './auth.js';
import { blockAgentEgress } from './agent-egress.js';
import { RaterStore } from '../rater/store.js';
import { computeDrives } from 'runcor-drives';
import type { ResourceInputs } from 'runcor-drives';

export interface DashboardArgs {
  bus: EventBus;
  env: V2Env;
  memory: MemorySystem;
  dataCube: DataCube;
  startupRecord: StartupRecord;
  terminationState: { isTerminated(): boolean; reason(): string | null };
  operatorDbPath: string;
  /** Optional control-process accessors (when V2 is co-located with the control process). */
  controlMemory?: MemorySystem;
  controlDataCube?: DataCube;
  /** Optional rater store path. When provided, /scores serves real scores. */
  raterDbPath?: string;
  /** Current cycle accessor for /drives etc. Defaults to 0 if absent. */
  getCurrentCycle?: () => number;
  /** Control-process cycle accessor — used by /overview?role=control + /drives?role=control. */
  getControlCycle?: () => number;
  /** Resource-pressure inputs accessor for /drives. Defaults to no resource pressure if absent. */
  getResourceInputs?: () => ResourceInputs;
  /** Engine adapter-tool snapshot for /startup-record currentTools (T128). Defaults to []. */
  getCurrentTools?: () => Array<{ name: string; description: string; adapter?: string }>;
}

export interface DashboardHandle {
  server: Server;
  port: number;
  close(): Promise<void>;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  jsonResponse(res, 404, { error: 'Not found', code: 'not_found' });
}

function paramOf(url: URL, key: string): string | null {
  const v = url.searchParams.get(key);
  return v && v.length > 0 ? v : null;
}

function readJsonBody<T = unknown>(req: IncomingMessage, max = 4096): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8') || '{}';
      try {
        resolve(JSON.parse(text) as T);
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

export function startDashboard(args: DashboardArgs): DashboardHandle {
  const operatorStore = new OperatorStore(args.operatorDbPath);

  const sseClients = new Map<number, ServerResponse>();
  let sseId = 0;
  // Forward bus events to all SSE clients.
  const forward = (event: string) => (data: Record<string, unknown>) => {
    for (const res of sseClients.values()) {
      try {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(payload);
      } catch {
        // Client disconnected; will be cleaned up on next iteration.
      }
    }
  };
  const eventNames = [
    'cycle_record',
    'prompt_assembled',
    'discernment',
    'discernment_flagged',
    'flag_burst_warning',
    'cost_request',
    'execution_state_change',
    'execution_complete',
    'adapter_tool_call',
    'adapter_connected',
    'adapter_disconnected',
    'provider_health_change',
    'next_wake_scheduled',
    'day_boundary',
    'startup_record',
    'harness_engaged',
    'harness_disengaged',
  ];
  const forwarders: Array<{ event: string; fn: (data: Record<string, unknown>) => void }> = [];
  for (const ev of eventNames) {
    const fn = forward(ev);
    forwarders.push({ event: ev, fn });
    args.bus.on(ev, fn);
  }

  // Per-role overview state — accumulated from bus events tagged with agentRole.
  // V2 and control share this bus when co-run (agent/index.ts wires both).
  const overviewSpent: Record<string, number> = { v2: 0, control: 0 };
  const overviewLastCycleAt: Record<string, number | null> = { v2: null, control: null };
  args.bus.on('cost_request', (ev: Record<string, unknown>) => {
    const role = typeof ev.agentRole === 'string' ? ev.agentRole : 'v2';
    const cost = typeof ev.cost === 'number' ? ev.cost : 0;
    if (cost > 0) overviewSpent[role] = (overviewSpent[role] ?? 0) + cost;
  });
  args.bus.on('cycle_record', (ev: Record<string, unknown>) => {
    const role = typeof ev.agentRole === 'string' ? ev.agentRole : 'v2';
    overviewLastCycleAt[role] = Date.now();
  });

  const handleOverview: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const role = paramOf(url, 'role') ?? 'v2';
    const isV2 = role !== 'control';
    const mem = isV2 ? args.memory : (args.controlMemory ?? args.memory);
    const summariesPublished = mem
      .getAll()
      .filter((n) => Array.isArray(n.tags) && n.tags.includes('daily_summary'))
      .length;
    const lastCycleAt = overviewLastCycleAt[role] ?? null;
    const lastCycleStatus = lastCycleAt
      ? new Date(lastCycleAt).toISOString().slice(11, 19) + ' UTC'
      : '—';
    const cycleCount = isV2
      ? (args.getCurrentCycle?.() ?? 0)
      : (args.getControlCycle?.() ?? 0);
    jsonResponse(res, 200, {
      role,
      cycleCount,
      lastCycleAt,
      lastCycleStatus,
      spentUsd: overviewSpent[role] ?? 0,
      capUsd: isV2 ? args.env.v2BudgetUsd : args.env.controlBudgetUsd,
      budgetUsd: isV2 ? args.env.v2BudgetUsd : args.env.controlBudgetUsd,
      summariesPublished,
      bootedAt: args.startupRecord.bootedAt,
      terminated: args.terminationState.isTerminated(),
    });
  };

  const handleHealthz: RequestHandler = (_req, res) => {
    jsonResponse(res, 200, {
      ok: true,
      agentRole: args.startupRecord.agentRole,
      bootedAt: args.startupRecord.bootedAt,
      terminated: args.terminationState.isTerminated(),
    });
  };

  const handleStartupRecord: RequestHandler = (_req, res) => {
    // T128 — extend startup-record with currently-registered tools (refreshes when integration runs).
    const currentTools = args.getCurrentTools?.() ?? [];
    jsonResponse(res, 200, { ...args.startupRecord, currentTools });
  };

  const handleTranscriptSse: RequestHandler = (req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('event: ping\ndata: {}\n\n');

    const id = ++sseId;
    sseClients.set(id, res);

    // Backfill via Last-Event-ID header.
    const lastEventId = req.headers['last-event-id'];
    if (typeof lastEventId === 'string') {
      const after = parseInt(lastEventId, 10);
      if (Number.isFinite(after)) {
        const buffered = args.bus.snapshotAfter(after);
        for (const e of buffered) {
          res.write(`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
        }
      }
    }

    const keepalive = setInterval(() => {
      try {
        res.write('event: ping\ndata: {}\n\n');
      } catch {
        // ignore
      }
    }, 30_000);

    req.on('close', () => {
      sseClients.delete(id);
      clearInterval(keepalive);
    });
  };

  const handleTranscriptHistory: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const after = parseInt(paramOf(url, 'after') ?? '0', 10);
    const limit = Math.min(500, Math.max(1, parseInt(paramOf(url, 'limit') ?? '100', 10)));
    const events = args.bus.snapshotAfter(Number.isFinite(after) ? after : 0).slice(0, limit);
    jsonResponse(res, 200, { events });
  };

  const handleMemory: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const role = paramOf(url, 'role') ?? 'v2';
    const mem = role === 'control' && args.controlMemory ? args.controlMemory : args.memory;
    const limit = Math.min(200, Math.max(1, parseInt(paramOf(url, 'limit') ?? '50', 10)));
    const all = mem.getAll();
    const nodes = all
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .slice(0, limit)
      .map((n) => ({
        id: n.id,
        content: n.content.slice(0, 200),
        tags: n.tags ?? [],
        M: n.M,
        R: n.R,
        f: n.f,
        t: n.t,
        D: n.D,
        cube: n.cube,
        createdAtCycle: n.lastAccessed, // best-effort with current schema
        lastAccessedCycle: n.lastAccessed,
      }));
    const stats = {
      shortCubeCount: all.filter((n) => n.cube === 'short').length,
      longCubeCount: all.filter((n) => n.cube === 'long').length,
      retiredCount: 0,
    };
    const plan = mem.getPlan();
    jsonResponse(res, 200, {
      stats,
      nodes,
      edges: [],
      plan,
      cursor: nodes.length > 0 ? nodes[nodes.length - 1]!.id : null,
      hasMore: all.length > limit,
    });
  };

  const handleMemoryNode: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const segments = url.pathname.split('/');
    const id = segments[segments.length - 1];
    if (!id) return notFound(res);
    const node = args.memory.getNode(id);
    if (!node) return notFound(res);
    jsonResponse(res, 200, { node });
  };

  const handleData: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const role = paramOf(url, 'role') ?? 'v2';
    const cube = role === 'control' && args.controlDataCube ? args.controlDataCube : args.dataCube;
    const stats = cube.getStats();
    const openConflicts = cube.listConflicts('open');
    jsonResponse(res, 200, {
      stats,
      entities: [],
      openConflicts,
      cursor: null,
      hasMore: false,
    });
  };

  const handleBlog: RequestHandler = (_req, res) => {
    const all = args.memory.getAll();
    const summaries = all
      .filter((n) => (n.tags ?? []).includes('daily_summary'))
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .map((n) => ({
        nodeId: n.id,
        content: n.content,
        tags: n.tags ?? [],
        M: n.M,
        createdAtCycle: n.lastAccessed,
      }));
    jsonResponse(res, 200, { summaries });
  };

  const rejectIfTerminated = (res: Parameters<RequestHandler>[1]): boolean => {
    if (!args.terminationState.isTerminated()) return false;
    jsonResponse(res, 503, {
      error: 'agent terminated; mutations are disabled',
      code: 'terminated',
      reason: args.terminationState.reason(),
    });
    return true;
  };

  const handleOperatorPause: RequestHandler = async (req, res) => {
    if (rejectIfTerminated(res)) return;
    const body = (await readJsonBody<{ scope?: 'v2' | 'control' | 'both' }>(req).catch(() => ({} as { scope?: 'v2' | 'control' | 'both' })));
    const scope = body.scope ?? 'v2';
    const token = extractBearerToken(req) ?? '';
    operatorStore.append({
      kind: 'pause',
      payload: { scope },
      authenticatedAs: OperatorStore.hashToken(token),
    });
    jsonResponse(res, 200, { paused: true, scope });
  };

  const handleOperatorResume: RequestHandler = async (req, res) => {
    if (rejectIfTerminated(res)) return;
    const body = (await readJsonBody<{ scope?: 'v2' | 'control' | 'both' }>(req).catch(() => ({} as { scope?: 'v2' | 'control' | 'both' })));
    const scope = body.scope ?? 'v2';
    const token = extractBearerToken(req) ?? '';
    operatorStore.append({
      kind: 'resume',
      payload: { scope },
      authenticatedAs: OperatorStore.hashToken(token),
    });
    jsonResponse(res, 200, { paused: false, scope });
  };

  const handleOperatorNote: RequestHandler = async (req, res) => {
    if (rejectIfTerminated(res)) return;
    const body = (await readJsonBody<{ note?: string }>(req).catch(() => ({} as { note?: string })));
    if (typeof body.note !== 'string' || body.note.length === 0 || body.note.length > 2000) {
      return jsonResponse(res, 400, { error: 'note required (1..2000 chars)', code: 'bad_request' });
    }
    const token = extractBearerToken(req) ?? '';
    const action = operatorStore.append({
      kind: 'infrastructure_note' as OperatorActionKind,
      payload: { note: body.note },
      authenticatedAs: OperatorStore.hashToken(token),
    });
    jsonResponse(res, 200, { id: action.id, ts: action.ts });
  };

  const handleOperatorLog: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const limit = Math.min(500, Math.max(1, parseInt(paramOf(url, 'limit') ?? '100', 10)));
    jsonResponse(res, 200, { actions: operatorStore.list({ limit }) });
  };

  const raterStore = args.raterDbPath ? new RaterStore(args.raterDbPath) : null;

  const handleScores: RequestHandler = (_req, res) => {
    if (!raterStore) {
      // No rater configured for this run — return empty arrays in the documented shape.
      jsonResponse(res, 200, { v2: [], control: [] });
      return;
    }
    const v2 = raterStore.list({ kind: 'v2', limit: 200 });
    const control = raterStore.list({ kind: 'control', limit: 200 });
    jsonResponse(res, 200, { v2, control });
  };

  const handleHypothesis: RequestHandler = async (_req, res) => {
    // Read the latest evaluation set from memory (cached by an out-of-band runner).
    const all = args.memory.getAll().filter((n) => (n.tags ?? []).includes('hypothesis_evaluation'));
    const evaluations = all
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .slice(0, 8) // 8 hypotheses
      .map((n) => {
        try {
          return JSON.parse(n.content) as Record<string, unknown>;
        } catch {
          return { error: 'parse_failed', content: n.content.slice(0, 200) };
        }
      });
    jsonResponse(res, 200, { evaluations });
  };

  const handleFrontend = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const reqUrl = req.url ?? '/';
    const url = new URL(reqUrl, 'http://x');
    const requested = url.pathname === '/' || url.pathname === '/dashboard' ? '/index.html' : url.pathname;
    const filePath = path.resolve(`./src/dashboard/frontend${requested}`);
    if (!filePath.startsWith(path.resolve('./src/dashboard/frontend'))) {
      return notFound(res);
    }
    try {
      const content = await readFile(filePath);
      const ext = path.extname(requested);
      const contentType =
        ext === '.html' ? 'text/html; charset=utf-8' :
        ext === '.js' ? 'application/javascript; charset=utf-8' :
        ext === '.css' ? 'text/css; charset=utf-8' :
        'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(content);
    } catch {
      notFound(res);
    }
  };

  const operatorToken = args.env.operatorAuthToken;

  const server = createServer(async (req, res) => {
    try {
      const reqUrl = req.url ?? '';
      const method = req.method ?? 'GET';
      const url = new URL(reqUrl, 'http://x');
      const pathname = url.pathname;

      if (pathname === '/healthz' && method === 'GET') return handleHealthz(req, res);
      if (pathname === '/overview' && method === 'GET') return handleOverview(req, res);
      if (pathname === '/startup-record' && method === 'GET') return handleStartupRecord(req, res);
      if (pathname === '/transcript' && method === 'GET') {
        const accept = req.headers.accept ?? '';
        if (accept.includes('text/event-stream')) return handleTranscriptSse(req, res);
        return handleTranscriptHistory(req, res);
      }
      if (pathname === '/memory' && method === 'GET') return handleMemory(req, res);
      if (pathname.startsWith('/memory/node/') && method === 'GET') return handleMemoryNode(req, res);
      if (pathname === '/data' && method === 'GET') return handleData(req, res);
      if (pathname === '/blog' && method === 'GET') return handleBlog(req, res);
      if (pathname === '/summaries' && method === 'GET') return handleBlog(req, res);
      if (pathname === '/scores' && method === 'GET') {
        return blockAgentEgress(requireBearerToken(operatorToken, handleScores))(req, res);
      }
      if (pathname === '/operator/pause' && method === 'POST') {
        return requireBearerToken(operatorToken, handleOperatorPause)(req, res);
      }
      if (pathname === '/operator/resume' && method === 'POST') {
        return requireBearerToken(operatorToken, handleOperatorResume)(req, res);
      }
      if (pathname === '/operator/note' && method === 'POST') {
        return requireBearerToken(operatorToken, handleOperatorNote)(req, res);
      }
      if (pathname === '/operator/log' && method === 'GET') return handleOperatorLog(req, res);

      // Identity / goals / drives / watchdog / coherence — thin reads for v0.1.
      if (pathname === '/identity' && method === 'GET') {
        const all = args.memory.getAll().filter((n) => (n.tags ?? []).includes('identity_snapshot'));
        return jsonResponse(res, 200, { snapshots: all.map((n) => ({ content: n.content, tags: n.tags, M: n.M })) });
      }
      if (pathname === '/goals' && method === 'GET') {
        return jsonResponse(res, 200, { plan: args.memory.getPlan() });
      }
      if (pathname === '/drives' && method === 'GET') {
        // FR-035 — recompute 4 pressures per request from current memory + temporal state.
        const role = paramOf(url, 'role') ?? 'v2';
        const mem = role === 'control' && args.controlMemory ? args.controlMemory : args.memory;
        const cycle = args.getCurrentCycle?.() ?? 0;
        const tagSet = new Set<string>();
        for (const n of mem.getAll()) for (const t of n.tags ?? []) tagSet.add(t);
        const exploredAreas = Array.from(tagSet);
        const resourceInputs = args.getResourceInputs?.();
        const pressure = computeDrives({
          ...(resourceInputs ? { resource: resourceInputs } : {}),
          curiosity: { exploredAreas, knownAreas: exploredAreas, recentExplorationCycles: 0 },
          reactivity: { pendingEvents: [] },
          coherence: { selfTheoryClaims: [], recentActions: [] },
        });
        return jsonResponse(res, 200, {
          resource: pressure.resource?.intensity ?? 0,
          curiosity: pressure.curiosity?.intensity ?? 0,
          reactivity: pressure.reactivity?.intensity ?? 0,
          coherence: pressure.coherence?.intensity ?? 0,
          computedAtCycle: cycle,
        });
      }
      if (pathname === '/watchdog' && method === 'GET') {
        const all = args.memory.getAll().filter((n) => (n.tags ?? []).includes('watchdog_finding'));
        return jsonResponse(res, 200, { findings: all });
      }
      if (pathname === '/coherence' && method === 'GET') {
        // FR-037 — active tasks (Plan filtered to category 'coherence_task') + open problems (memory
        // tagged ['coherence_problem','open']) + initiated flows (memory tagged ['coherence_flow']).
        const role = paramOf(url, 'role') ?? 'v2';
        const mem = role === 'control' && args.controlMemory ? args.controlMemory : args.memory;
        const all = mem.getAll();
        const plan = mem.getPlan();
        const planItems = (plan?.items ?? []) as Array<{ category?: string; description?: string; id?: string }>;
        const activeTasks = planItems.filter((it) => typeof it.category === 'string' && it.category === 'coherence_task');
        const openProblems = all.filter((n) => {
          const t = n.tags ?? [];
          return t.includes('coherence_problem') && t.includes('open');
        });
        const initiatedFlows = all.filter((n) => (n.tags ?? []).includes('coherence_flow'));
        return jsonResponse(res, 200, { activeTasks, openProblems, initiatedFlows });
      }
      if (pathname === '/result' && method === 'GET') {
        const role = paramOf(url, 'role') ?? 'v2';
        const resultFile = path.join(args.env.agentStateDir, `result-${role}.md`);
        try {
          const content = await readFile(resultFile);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.end(content);
        } catch {
          notFound(res);
        }
        return;
      }
      if (pathname === '/hypothesis' && method === 'GET') return handleHypothesis(req, res);
      if (pathname === '/rater' && method === 'GET') {
        // /rater is the rubric-info endpoint; /scores is the rated-output endpoint.
        const { rubricHash, RUBRIC_VERSION } = await import('../rater/rubric.js');
        return jsonResponse(res, 200, { version: RUBRIC_VERSION, hash: rubricHash() });
      }

      if (method === 'GET') {
        return handleFrontend(req, res);
      }
      return notFound(res);
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : 'internal_error', code: 'internal_error' });
    }
  });

  server.listen(args.env.dashboardPort, args.env.dashboardHost);

  return {
    server,
    port: args.env.dashboardPort,
    async close(): Promise<void> {
      for (const f of forwarders) args.bus.off(f.event, f.fn);
      for (const res of sseClients.values()) {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      operatorStore.close();
      if (raterStore) raterStore.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
