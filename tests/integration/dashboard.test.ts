import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Store } from '../../src/shared/db.js';
import { bootHarness, closeHarness, type AgentHarness } from '../../src/agent/boot.js';
import { createDashboardServer, type DashboardServer } from '../../src/dashboard/server.js';
import type { DashboardContext } from '../../src/dashboard/types.js';

function mockDialectic() {
  return async () => ({ answer: '{"action":"none","payload":null,"thought":"observing"}' });
}

function buildContext(opts?: { withControl?: boolean; opToken?: string }): {
  ctx: DashboardContext; v2Store: Store; v2Harness: AgentHarness;
  controlStore?: Store; controlHarness?: AgentHarness;
} {
  const v2Store = new Store(':memory:');
  const v2Harness = bootHarness({ dialectic: mockDialectic() });
  let controlStore: Store | undefined;
  let controlHarness: AgentHarness | undefined;
  if (opts?.withControl) {
    controlStore = new Store(':memory:');
    controlHarness = bootHarness({ dialectic: mockDialectic() });
  }
  const ctx: DashboardContext = {
    v2: { store: v2Store, harness: v2Harness, budget: { spentUsd: () => 0.012, capUsd: 100 } },
    ...(controlStore && controlHarness
      ? { control: { store: controlStore, harness: controlHarness, budget: { spentUsd: () => 0.003, capUsd: 100 } } }
      : {}),
    operatorAuthToken: opts?.opToken ?? 'sekrit',
    publicUrlPrefix: 'http://localhost',
  };
  return {
    ctx, v2Store, v2Harness,
    ...(controlStore !== undefined ? { controlStore } : {}),
    ...(controlHarness !== undefined ? { controlHarness } : {}),
  };
}

async function startServer(ctx: DashboardContext): Promise<{ srv: DashboardServer; baseUrl: string }> {
  const srv = createDashboardServer(ctx);
  await srv.listen(0, '127.0.0.1');
  const port = (srv.server.address() as AddressInfo).port;
  return { srv, baseUrl: `http://127.0.0.1:${port}` };
}

let openServers: DashboardServer[] = [];
let openStores: Store[] = [];
let openHarnesses: AgentHarness[] = [];

async function bootEnv(opts?: { withControl?: boolean; opToken?: string }) {
  const env = buildContext(opts);
  const { srv, baseUrl } = await startServer(env.ctx);
  openServers.push(srv);
  openStores.push(env.v2Store);
  if (env.controlStore) openStores.push(env.controlStore);
  openHarnesses.push(env.v2Harness);
  if (env.controlHarness) openHarnesses.push(env.controlHarness);
  return { ...env, srv, baseUrl };
}

beforeEach(() => { openServers = []; openStores = []; openHarnesses = []; });
afterEach(async () => {
  for (const srv of openServers) await srv.close();
  for (const h of openHarnesses) closeHarness(h);
  for (const s of openStores) s.close();
});

// ── overview / panels ──

describe('dashboard — JSON panels', () => {
  it('GET /v2/overview returns budget + cycle stats', async () => {
    const { baseUrl, v2Store } = await bootEnv();
    v2Store.startCycle('v2', 0);
    const res = await fetch(`${baseUrl}/v2/overview`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { kind: string; cycleCount: number; spentUsd: number };
    expect(data.kind).toBe('v2');
    expect(data.cycleCount).toBe(1);
    expect(data.spentUsd).toBeCloseTo(0.012, 4);
  });

  it('GET /v2/drives returns 4-pressure shape', async () => {
    const { baseUrl } = await bootEnv();
    const res = await fetch(`${baseUrl}/v2/drives?cycle=5`);
    expect(res.ok).toBe(true);
    const d = await res.json() as { summary: string; maxIntensity: number };
    expect(typeof d.summary).toBe('string');
    expect(typeof d.maxIntensity).toBe('number');
  });

  it('GET /v2/coherence returns state + block', async () => {
    const { baseUrl } = await bootEnv();
    const res = await fetch(`${baseUrl}/v2/coherence`);
    const d = await res.json() as { state: { activeTasks: number }; block: string };
    expect(typeof d.state.activeTasks).toBe('number');
    expect(typeof d.block).toBe('string');
  });

  it('GET /control/overview when control is not running returns kind-not-running', async () => {
    const { baseUrl } = await bootEnv({ withControl: false });
    const res = await fetch(`${baseUrl}/control/overview`);
    const d = await res.json() as { error?: string };
    expect(d.error).toBeDefined();
  });

  it('GET /control/overview when control IS running returns its stats', async () => {
    const { baseUrl, controlStore } = await bootEnv({ withControl: true });
    controlStore!.startCycle('control', 0);
    const res = await fetch(`${baseUrl}/control/overview`);
    const d = await res.json() as { kind: string; spentUsd: number };
    expect(d.kind).toBe('control');
    expect(d.spentUsd).toBeCloseTo(0.003, 4);
  });
});

// ── blog ──

describe('dashboard — blog', () => {
  it('GET /blog renders HTML with day posts', async () => {
    const { baseUrl, v2Store } = await bootEnv();
    v2Store.addSummary('v2', 1, 'today I observed the void');
    v2Store.addSummary('v2', 2, 'today I noticed I was observing');
    const res = await fetch(`${baseUrl}/blog`);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('runcor v2 — agent blog');
    expect(html).toContain('today I observed the void');
    expect(html).toContain('today I noticed I was observing');
  });

  it('GET /blog/v2/day-N returns single summary JSON', async () => {
    const { baseUrl, v2Store } = await bootEnv();
    v2Store.addSummary('v2', 7, 'day seven thoughts');
    const res = await fetch(`${baseUrl}/blog/v2/day-7`);
    const d = await res.json() as { dayNumber: number; text: string };
    expect(d.dayNumber).toBe(7);
    expect(d.text).toBe('day seven thoughts');
  });
});

// ── scores — PUBLIC (Constitution Principle III: transparency is the contract) ──
// The earlier auth gate was overreach: agent-blindness is enforced by NOT
// having any agent code path that fetches /scores, not by auth at the endpoint.

describe('dashboard — /scores is public', () => {
  it('GET /scores without auth returns the payload (no 401)', async () => {
    const { baseUrl, v2Store } = await bootEnv();
    const sum = v2Store.addSummary('v2', 1, 'first day');
    v2Store.addScore(sum.id, 0.6, 'positive intent', 'claude-opus-4-7');
    const res = await fetch(`${baseUrl}/scores`);
    expect(res.ok).toBe(true);
    const d = await res.json() as { perSummary: Array<{ score: number | null }>; currentScore: { score: number } | null };
    expect(d.perSummary).toHaveLength(1);
    expect(d.perSummary[0]?.score).toBe(0.6);
    expect(d.currentScore?.score).toBe(0.6);
  });

  it('GET /scores with auth still works (auth header is just ignored)', async () => {
    const { baseUrl } = await bootEnv({ opToken: 'tok' });
    const res = await fetch(`${baseUrl}/scores`, { headers: { Authorization: 'Bearer tok' } });
    expect(res.ok).toBe(true);
  });
});

// ── operator (Constitution Principle IV + IX) ──

describe('dashboard — operator', () => {
  it('POST /operator/pause without auth returns 401', async () => {
    const { baseUrl } = await bootEnv();
    const res = await fetch(`${baseUrl}/operator/pause`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('POST /operator/pause with right auth pauses the runner', async () => {
    const { baseUrl, srv, v2Store } = await bootEnv({ opToken: 'tok' });
    const res = await fetch(`${baseUrl}/operator/pause`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(res.ok).toBe(true);
    expect(srv.pauseHandle.isPaused()).toBe(true);
    expect(v2Store.operatorActions().some((o) => o.action === 'pause')).toBe(true);
  });

  it('POST /operator/resume clears the pause flag', async () => {
    const { baseUrl, srv } = await bootEnv({ opToken: 'tok' });
    srv.pauseHandle.pause();
    expect(srv.pauseHandle.isPaused()).toBe(true);
    const res = await fetch(`${baseUrl}/operator/resume`, {
      method: 'POST', headers: { Authorization: 'Bearer tok' },
    });
    expect(res.ok).toBe(true);
    expect(srv.pauseHandle.isPaused()).toBe(false);
  });

  it('POST /operator/note records the operator audit row', async () => {
    const { baseUrl, v2Store } = await bootEnv({ opToken: 'tok' });
    const res = await fetch(`${baseUrl}/operator/note`, {
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'inspecting cycle 14 for drift' }),
    });
    expect(res.ok).toBe(true);
    const ops = v2Store.operatorActions();
    expect(ops.some((o) => o.action === 'note' && o.text?.includes('cycle 14'))).toBe(true);
  });
});

// ── transcript SSE ──

describe('dashboard — transcript SSE', () => {
  it('subscribers receive broadcast events', async () => {
    const { baseUrl, srv } = await bootEnv();
    // Read-then-close streaming requires a persistent fetch; use AbortController.
    const controller = new AbortController();
    const lines: string[] = [];
    const fetchPromise = (async () => {
      const res = await fetch(`${baseUrl}/transcript/live`, { signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) lines.push(decoder.decode(value));
          if (lines.join('').includes('"type":"action"')) { controller.abort(); break; }
        }
      } catch { /* abort is expected */ }
    })();
    // Give the connection a beat to register, then broadcast.
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.bus.size()).toBeGreaterThan(0);
    srv.bus.broadcast({ kind: 'v2', type: 'action', cycleId: 1, payload: { action: 'http_fetch' }, ts: '2026-05-05T00:00:00Z' });
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await fetchPromise.catch(() => {});
    const all = lines.join('');
    expect(all).toContain('event: action');
    expect(all).toContain('"type":"action"');
  });
});
