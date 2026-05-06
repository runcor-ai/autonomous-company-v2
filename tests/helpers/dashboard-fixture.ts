// Minimal dashboard boot fixture for contract tests.
// Spins up a real `startDashboard(...)` against an isolated state dir + minimal memory / data.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import { DataCube } from 'runcor-data';
import { startDashboard, type DashboardHandle } from '../../src/dashboard/server.js';
import { EventBus } from '../../src/dashboard/event-bus.js';
import { buildStartupRecord, type StartupRecord } from '../../src/boot/startup-record.js';
import type { V2Env } from '../../src/shared/env.js';

export interface DashboardFixture {
  handle: DashboardHandle;
  bus: EventBus;
  memory: MemorySystem;
  dataCube: DataCube;
  env: V2Env;
  startupRecord: StartupRecord;
  baseUrl: string;
  operatorAuthToken: string;
  cleanup(): Promise<void>;
}

const stubModel = {
  async complete(): Promise<{ text: string }> {
    return { text: '' };
  },
};

export async function createDashboardFixture(opts: { port?: number; agentEgressIps?: string } = {}): Promise<DashboardFixture> {
  const dir = mkdtempSync(path.join(tmpdir(), 'dash-fix-'));
  const memDbPath = path.join(dir, 'memory.db');
  const dataDbPath = path.join(dir, 'data.db');
  const operatorDbPath = path.join(dir, 'operator.db');

  const memDb = new MemoryDatabase(memDbPath);
  const memory = new MemorySystem({ db: memDb, agentRole: 'test' });
  const dataCube = new DataCube({ dbPath: dataDbPath, model: stubModel });

  const port = opts.port ?? (8081 + Math.floor(Math.random() * 1000));
  const operatorAuthToken = 'test-operator-token';
  const env: V2Env = {
    openrouterApiKey: 'sk-or-test',
    operatorAuthToken,
    maxCycles: 10,
    v2BudgetUsd: 1,
    controlBudgetUsd: 1,
    controlIntervalSeconds: 30,
    dashboardHost: '127.0.0.1',
    dashboardPort: port,
    dashboardPublicUrl: `http://127.0.0.1:${port}`,
    raterModel: 'anthropic/claude-3.5-sonnet',
    raterIntervalMs: 60000,
    agentStateDir: dir,
    scratchpadDir: path.join(dir, 'scratchpad'),
    harnessMonitorIntervalCycles: 100,
    cycleRecordBufferSize: 50,
    resetOnBoot: false,
  };

  const bus = new EventBus({ bufferSize: 50 });
  const startupRecord = buildStartupRecord({
    agentRole: 'v2',
    envSummary: {
      hasOpenRouterKey: true,
      hasOperatorAuthToken: true,
      hasFirecrawlKey: false,
      hasRunnerEmail: false,
      hasGitPushCreds: false,
    },
    substrateInstallerEngaged: true,
  });

  // Save + restore AGENT_EGRESS_IPS for this fixture.
  const priorEgress = process.env.AGENT_EGRESS_IPS;
  if (opts.agentEgressIps) {
    process.env.AGENT_EGRESS_IPS = opts.agentEgressIps;
  }

  const handle = startDashboard({
    bus,
    env,
    memory,
    dataCube,
    startupRecord,
    terminationState: { isTerminated: () => false, reason: () => null },
    operatorDbPath,
  });

  // Wait for listen to fire.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));

  return {
    handle,
    bus,
    memory,
    dataCube,
    env,
    startupRecord,
    baseUrl: `http://127.0.0.1:${port}`,
    operatorAuthToken,
    cleanup: async (): Promise<void> => {
      await handle.close();
      try {
        memDb.close?.();
      } catch {
        // ignore
      }
      try {
        dataCube.close();
      } catch {
        // ignore
      }
      if (priorEgress === undefined) delete process.env.AGENT_EGRESS_IPS;
      else process.env.AGENT_EGRESS_IPS = priorEgress;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

export interface FetchResult {
  status: number;
  body: string;
  json?: unknown;
}

export function get(url: string, headers: Record<string, string> = {}): Promise<FetchResult> {
  return request('GET', url, headers);
}

export function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<FetchResult> {
  return request('POST', url, headers, body);
}

function request(method: string, url: string, headers: Record<string, string>, body?: unknown): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = undefined;
        try {
          json = JSON.parse(text);
        } catch {
          // leave undefined
        }
        resolve({ status: res.statusCode ?? 0, body: text, ...(json !== undefined ? { json } : {}) });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
