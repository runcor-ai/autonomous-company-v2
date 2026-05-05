// Dashboard HTTP server — Node built-in http; no extra deps.
//
// Exposes JSON state panels, an SSE transcript stream, the public blog,
// the agent-blind scores endpoint, operator pause/resume/note, and a single
// frontend page that consumes all of the above.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { KindContext, DashboardContext } from './types.js';
import {
  memoryPanel, identityPanel, goalsPanel, drivesPanel,
  watchdogPanel, coherencePanel, summariesPanel, overviewPanel,
} from './routes/panels.js';
import { recentTranscript, attachSseStream, TranscriptBus } from './routes/transcript.js';
import { blogJson, blogSinglePostJson, blogIndexHtml } from './routes/blog.js';
import { scoresPayload, isAuthorizedForScores } from './routes/scores.js';
import { handleOperatorRequest, createOperatorPauseHandle, type OperatorPauseHandle, type OperatorVerb } from './routes/operator.js';

export interface DashboardServer {
  server: Server;
  bus: TranscriptBus;
  pauseHandle: OperatorPauseHandle;
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}

const FRONTEND_DIR = path.dirname(fileURLToPath(import.meta.url)).includes('dist')
  ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'dashboard', 'frontend')
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'frontend');

export function createDashboardServer(ctx: DashboardContext): DashboardServer {
  const bus = new TranscriptBus();
  const pauseHandle = createOperatorPauseHandle();

  const server = createServer((req, res) => handleRequest(req, res, ctx, bus, pauseHandle).catch((err) => {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (err as Error).message }));
  }));

  return {
    server,
    bus,
    pauseHandle,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve());
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: DashboardContext,
  bus: TranscriptBus,
  pauseHandle: OperatorPauseHandle,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  const cycleParam = parseInt(url.searchParams.get('cycle') ?? '0', 10) || 0;

  // Helper to choose v2 vs control context.
  const pickKindCtx = (kind: 'v2' | 'control'): KindContext | undefined =>
    kind === 'v2' ? ctx.v2 : ctx.control;

  // ── SSE: live transcript ──
  if (pathname === '/transcript/live') {
    const send = attachSseStream(res);
    const unsub = bus.subscribe(send);
    req.on('close', () => unsub());
    return;
  }

  // ── JSON panels (per-kind) ──
  const jsonRoutes: Array<[RegExp, (m: RegExpExecArray) => unknown]> = [
    [/^\/(?:v2|control)\/overview$/, (m) => {
      const kind = m[0].split('/')[1] as 'v2' | 'control';
      const c = pickKindCtx(kind); return c ? overviewPanel(c, kind) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/transcript$/, (m) => {
      const kind = m[0].split('/')[1] as 'v2' | 'control';
      const c = pickKindCtx(kind); return c ? recentTranscript(c, kind, 50) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/memory$/, (m) => {
      const c = pickKindCtx(m[0].split('/')[1] as 'v2' | 'control');
      return c ? memoryPanel(c, cycleParam) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/identity$/, (m) => {
      const c = pickKindCtx(m[0].split('/')[1] as 'v2' | 'control');
      return c ? identityPanel(c) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/goals$/, (m) => {
      const c = pickKindCtx(m[0].split('/')[1] as 'v2' | 'control');
      return c ? goalsPanel(c, cycleParam) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/drives$/, (m) => {
      const c = pickKindCtx(m[0].split('/')[1] as 'v2' | 'control');
      return c ? drivesPanel(c, cycleParam) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/watchdog$/, (m) => {
      const c = pickKindCtx(m[0].split('/')[1] as 'v2' | 'control');
      return c ? watchdogPanel(c) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/coherence$/, (m) => {
      const c = pickKindCtx(m[0].split('/')[1] as 'v2' | 'control');
      return c ? coherencePanel(c) : { error: 'kind not running' };
    }],
    [/^\/(?:v2|control)\/summaries$/, (m) => {
      const kind = m[0].split('/')[1] as 'v2' | 'control';
      const c = pickKindCtx(kind); return c ? summariesPanel(c, kind) : { error: 'kind not running' };
    }],
  ];

  for (const [re, handler] of jsonRoutes) {
    const m = re.exec(pathname);
    if (m) return sendJson(res, handler(m));
  }

  // ── Blog (HTML public + JSON API) ──
  if (pathname === '/blog' || pathname === '/blog/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(blogIndexHtml(ctx.v2, ctx.publicUrlPrefix));
    return;
  }
  let m: RegExpExecArray | null;
  if ((m = /^\/blog\/(v2|control)\/day-(\d+)$/.exec(pathname))) {
    const kind = m[1] as 'v2' | 'control';
    const day = parseInt(m[2]!, 10);
    const c = pickKindCtx(kind);
    return sendJson(res, c ? blogSinglePostJson(c, kind, day) : { error: 'kind not running' });
  }
  if ((m = /^\/blog\/(v2|control)$/.exec(pathname))) {
    const kind = m[1] as 'v2' | 'control';
    const c = pickKindCtx(kind);
    return sendJson(res, c ? blogJson(c, kind) : { error: 'kind not running' });
  }

  // ── Scores — agent-blind (auth required) ──
  if (pathname === '/scores') {
    const auth = req.headers['authorization'];
    if (!isAuthorizedForScores(typeof auth === 'string' ? auth : undefined, ctx.operatorAuthToken)) {
      return sendJson(res, { error: 'unauthorized' }, 401);
    }
    return sendJson(res, scoresPayload(ctx.v2, ctx.control));
  }

  // ── Operator (POST /operator/{verb}) ──
  if (pathname.startsWith('/operator/') && req.method === 'POST') {
    const verb = pathname.slice('/operator/'.length) as OperatorVerb;
    const body = await readBody(req);
    let text: string | undefined;
    try {
      const parsed = body.length > 0 ? (JSON.parse(body) as { text?: unknown }) : {};
      if (typeof parsed.text === 'string') text = parsed.text;
    } catch { /* fall through */ }
    const result = handleOperatorRequest(
      {
        authHeader: typeof req.headers['authorization'] === 'string' ? (req.headers['authorization'] as string) : undefined,
        expectedToken: ctx.operatorAuthToken,
        verb,
        ...(text !== undefined ? { text } : {}),
      },
      ctx.v2,
      pauseHandle,
    );
    return sendJson(res, result.body, result.status);
  }

  // ── Frontend (single-page) ──
  if (pathname === '/' || pathname === '/index.html') {
    return serveStatic(res, path.join(FRONTEND_DIR, 'index.html'), 'text/html; charset=utf-8');
  }
  if (pathname === '/app.js') {
    return serveStatic(res, path.join(FRONTEND_DIR, 'app.js'), 'application/javascript');
  }
  if (pathname === '/style.css') {
    return serveStatic(res, path.join(FRONTEND_DIR, 'style.css'), 'text/css');
  }

  // 404
  sendJson(res, { error: 'not found', path: pathname }, 404);
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function serveStatic(res: ServerResponse, filePath: string, contentType: string): void {
  try {
    const buf = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
