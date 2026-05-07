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
  /** Optional cheap-model paraphraser for /cycle-summary. Called with structured cycle data
   *  (action mix + recent reasoning bullets), returns 2-3 sentence narrative paraphrase.
   *  Server caches result for 60s per role to avoid bursting LLM calls. Observer-side only. */
  summarizeRecent?: (input: { role: string; bullets: string[]; actions: Array<{ action: string; count: number }> }) => Promise<string>;
  /** Dashboard-side hierarchical summary store (purely observer-layer; not in runcor-memory).
   *  Generator writes L1 chunks every 20 cycles; /cycle-summary reads all chunks. */
  summaryStore?: import('./summary-store.js').SummaryStore;
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

  // Cycle-summary cache: cheap-model paraphrase per role, 60s TTL (HTML promised this).
  const summaryCache: Record<string, { summary: string; lastCycle: number; generatedAt: string; actionMix: Array<{ action: string; count: number }>; bullets: string[]; expiresAt: number }> = {};
  const SUMMARY_TTL_MS = 60_000;

  const handleCycleSummary: RequestHandler = async (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const role = paramOf(url, 'role') ?? 'v2';
    const limit = Math.min(20, Math.max(1, parseInt(paramOf(url, 'limit') ?? '5', 10)));

    // Pull recent bus events. Some events (execution_complete, cost_request) don't carry
    // a `cycle` field — the engine emits them without that context. Walk events in order
    // and attach each to the most recent cycle_record's cycle for the same role.
    const allEvents = args.bus.snapshotAfter(0);
    const sortedEvents = [...allEvents].sort((a, b) => ((a as { id?: number }).id ?? 0) - ((b as { id?: number }).id ?? 0));
    const currentCycleByRole: Record<string, number | undefined> = {};
    const byCycle = new Map<number, Array<typeof sortedEvents[number]>>();
    for (const ev of sortedEvents) {
      const d = ev.data as Record<string, unknown> | undefined;
      const r = typeof d?.agentRole === 'string' ? d.agentRole : 'v2';
      // cycle_record events advance the "current cycle" pointer for their role.
      if (ev.event === 'cycle_record' && typeof d?.cycle === 'number') {
        currentCycleByRole[r] = d.cycle;
      }
      if (r !== role) continue;
      // Use the event's own cycle if present, otherwise inherit from the role's current cycle.
      const cycle = typeof d?.cycle === 'number' ? d.cycle : currentCycleByRole[r];
      if (typeof cycle !== 'number') continue;
      if (!byCycle.has(cycle)) byCycle.set(cycle, []);
      byCycle.get(cycle)!.push(ev);
    }
    const sortedCycles = Array.from(byCycle.entries()).sort((a, b) => b[0] - a[0]).slice(0, limit);
    const actionMap = new Map<string, number>();
    const bullets: string[] = [];
    let lastCycle = -1;
    for (const [cycleNum, evs] of sortedCycles) {
      if (cycleNum > lastCycle) lastCycle = cycleNum;
      const exec = evs.find((e) => e.event === 'execution_complete');
      if (exec) {
        const text = (exec.data as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
        const respText = typeof text?.text === 'string' ? text.text : '';
        let action = '?';
        let reasoning = '';
        try {
          const stripped = respText.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, '').trim();
          const parsed = JSON.parse(stripped) as { action?: string; reasoning?: string };
          action = parsed.action ?? '?';
          reasoning = parsed.reasoning ?? '';
        } catch (_) {
          reasoning = respText.slice(0, 200);
        }
        actionMap.set(action, (actionMap.get(action) ?? 0) + 1);
        bullets.push(`cycle ${cycleNum} action=${action} — ${reasoning.slice(0, 200)}`);
      }
    }
    const actionMix = Array.from(actionMap.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    // Read ALL L1 chunks from the dashboard summary store (NOT runcor-memory — these
    // are observer-layer artifacts the agent never sees). Concatenated newest-first
    // they cover every cycle since boot.
    const l1Chunks = (args.summaryStore?.list(role as 'v2' | 'control') ?? [])
      .filter((c) => c.tier === 'L1')
      .sort((a, b) => b.endCycle - a.endCycle);

    const now = Date.now();
    const cached = summaryCache[role];
    const cacheKey = `${lastCycle}:${l1Chunks.length}`;
    if (cached && cached.expiresAt > now && cached.bullets.join('|') === cacheKey) {
      jsonResponse(res, 200, { ...cached, fromCache: true, actionMix });
      return;
    }

    // In-progress chunk = cycles after the most recent L1 chunk's end.
    const lastL1End = l1Chunks.length > 0 && l1Chunks[0] ? l1Chunks[0].endCycle : -1;
    const sections: string[] = [];
    if (bullets.length > 0 && lastCycle > lastL1End) {
      const nextCheckpoint = lastL1End + 5; // matches SUMMARY_INTERVAL_CYCLES in agent/index.ts
      sections.push(`## In progress (cycles ${lastL1End + 1}..${lastCycle})\n\n*${bullets.length} cycles since last summary checkpoint. Next checkpoint at cycle ${nextCheckpoint}.*\n\n` +
        bullets.slice(0, 5).map((b) => `- ${b}`).join('\n'));
    }
    for (const chunk of l1Chunks.slice(0, 30)) {
      sections.push(`## Cycles ${chunk.startCycle}..${chunk.endCycle}\n\n${chunk.content}`);
    }
    const summary = sections.length > 0
      ? sections.join('\n\n---\n\n')
      : '_No cycles recorded yet — first summary checkpoint at cycle 20._';

    const generatedAt = new Date().toISOString();
    summaryCache[role] = { summary, lastCycle, generatedAt, actionMix, bullets: [cacheKey], expiresAt: now + SUMMARY_TTL_MS };
    jsonResponse(res, 200, {
      summary, lastCycle, generatedAt, fromCache: false, actionMix,
      chunkCount: l1Chunks.length,
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

  const handleScoreSummary: RequestHandler = (req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const role = paramOf(url, 'role') === 'control' ? 'control' : 'v2';
    // Single rolling overall summary — read the latest (and only) chunk.
    const chunks = args.summaryStore?.listScoreChunks(role) ?? [];
    const latest = chunks.length > 0 ? chunks[chunks.length - 1] : null;
    const summary = latest
      ? latest.content
      : '_No score summary yet — first overall summary after the first scoring round._';
    jsonResponse(res, 200, {
      role, summary,
      lastEndCycle: latest?.endCycle ?? 0,
      scoreCount: latest?.scoreCount ?? 0,
      meanScore: latest?.meanScore ?? null,
      generatedAt: new Date().toISOString(),
    });
  };

  const handleHypothesis: RequestHandler = async (_req, res) => {
    // The frontend renders one card per seed hypothesis with the most recent
    // evaluation embedded as `latest`. Returns an Array<{ id, title, description,
    // latest: EvaluationResult|null }>.
    const seed = (await import('../hypothesis/seed.js')).SEED_HYPOTHESES;
    const evalNodes = args.memory.getAll().filter((n) => (n.tags ?? []).includes('hypothesis_evaluation'));
    const latestById = new Map<string, { eval: Record<string, unknown>; lastAccessed: number }>();
    for (const n of evalNodes) {
      try {
        const parsed = JSON.parse(n.content) as { hypothesisId?: string };
        const id = parsed.hypothesisId;
        if (typeof id !== 'string') continue;
        const prior = latestById.get(id);
        if (!prior || n.lastAccessed > prior.lastAccessed) {
          latestById.set(id, { eval: parsed as unknown as Record<string, unknown>, lastAccessed: n.lastAccessed });
        }
      } catch {
        // ignore parse failures
      }
    }
    const cards = seed.map((h) => ({
      id: h.id,
      title: h.title,
      description: h.description,
      latest: latestById.get(h.id)?.eval ?? null,
    }));
    jsonResponse(res, 200, cards);
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
      if (pathname === '/cycle-summary' && method === 'GET') return handleCycleSummary(req, res);
      if (pathname === '/score-summary' && method === 'GET') return handleScoreSummary(req, res);
      if (pathname === '/scores' && method === 'GET') {
        // Public read per Principle III (transparency). Agent-egress filter still
        // blocks the agent's own process from reading its scores (FR-039).
        return blockAgentEgress(handleScores)(req, res);
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
      if ((pathname === '/hypothesis' || pathname === '/hypotheses') && method === 'GET') return handleHypothesis(req, res);
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
