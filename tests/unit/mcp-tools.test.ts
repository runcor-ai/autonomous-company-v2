// MCP local module — tool composition + adapter config (T060, T071).
//
// Verifies that:
//   - createLocalMcpServer wires all 12 tools into the adapter config.
//   - asAdapterConfig returns runcor-shaped AdapterConfig with transport: 'in-process'.
//   - tool result helpers produce the canonical { ok, ... } / { ok: false, error } shapes.

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import { DataCube } from 'runcor-data';
import { createLocalMcpServer, LOCAL_TOOL_FACTORIES, LOCAL_ADAPTER_NAME } from '../../src/mcp-local/index.js';
import { okResult, errResult } from '../../src/mcp-local/tool-result.js';
import type { V2Env } from '../../src/shared/env.js';

let memory: MemorySystem;
let dataCube: DataCube;

const ENV_STUB: V2Env = {
  openrouterApiKey: 'test',
  operatorAuthToken: 'test',
  maxCycles: 100,
  v2BudgetUsd: 100,
  controlBudgetUsd: 100,
  controlIntervalSeconds: 300,
  dashboardHost: '0.0.0.0',
  dashboardPort: 8080,
  dashboardPublicUrl: 'http://localhost:8080',
  raterModel: 'test',
  raterIntervalMs: 60_000,
  agentStateDir: '/tmp/v2-agent-state',
  scratchpadDir: '/tmp/v2-scratchpad',
  harnessMonitorIntervalCycles: 100,
  cycleRecordBufferSize: 200,
  resetOnBoot: false,
};

beforeEach(() => {
  memory = new MemorySystem({ db: new MemoryDatabase(':memory:') });
  dataCube = new DataCube({ dbPath: ':memory:' });
});

afterEach(() => {
  // :memory: dbs are released when garbage collected; nothing to clean.
});

describe('createLocalMcpServer', () => {
  test('exposes all 12 tools', () => {
    const server = createLocalMcpServer({
      env: ENV_STUB,
      memory,
      dataCube,
      agentRole: 'v2',
      context: { cycle: () => 0, dayOfRun: () => 0 },
      requestTerminate: () => undefined,
    });
    expect(server.tools).toHaveLength(LOCAL_TOOL_FACTORIES.length);
    expect(server.tools).toHaveLength(12);
  });

  test('asAdapterConfig produces in-process AdapterConfig (FR-200, runcor v0.3.x)', () => {
    const server = createLocalMcpServer({
      env: ENV_STUB,
      memory,
      dataCube,
      agentRole: 'v2',
      context: { cycle: () => 0, dayOfRun: () => 0 },
      requestTerminate: () => undefined,
    });
    const cfg = server.asAdapterConfig();
    expect(cfg.name).toBe(LOCAL_ADAPTER_NAME);
    expect(cfg.transport).toBe('in-process');
    expect(cfg.tools).toBeDefined();
    expect(cfg.tools!.length).toBe(12);
  });

  test('all 10 expected tool names are present', () => {
    const server = createLocalMcpServer({
      env: ENV_STUB,
      memory,
      dataCube,
      agentRole: 'v2',
      context: { cycle: () => 0, dayOfRun: () => 0 },
      requestTerminate: () => undefined,
    });
    const names = server.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'email_send',
      'fetch_chunk',
      'firecrawl_scrape',
      'fs_read',
      'fs_write',
      'git_push',
      'github_create_issue',
      'github_create_repo',
      'inbox_read',
      'publish_post',
      'terminate',
      'web_search',
    ]);
  });
});

describe('tool result helpers', () => {
  test('okResult wraps payload', () => {
    const r = okResult({ x: 1 });
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content[0]!.text!) as { ok: boolean; x: number };
    expect(parsed).toEqual({ ok: true, x: 1 });
  });

  test('errResult marks isError + includes error code', () => {
    const r = errResult('not_found', { foo: 'bar' });
    expect(r.isError).toBe(true);
    const parsed = JSON.parse(r.content[0]!.text!) as { ok: boolean; error: string; foo: string };
    expect(parsed).toEqual({ ok: false, error: 'not_found', foo: 'bar' });
  });
});

describe('terminate tool sets the termination signal', () => {
  test('handler calls requestTerminate', async () => {
    let captured = '';
    const server = createLocalMcpServer({
      env: ENV_STUB,
      memory,
      dataCube,
      agentRole: 'v2',
      context: { cycle: () => 5, dayOfRun: () => 0 },
      requestTerminate: (reason) => {
        captured = reason;
      },
    });
    const terminate = server.tools.find((t) => t.name === 'terminate');
    expect(terminate).toBeDefined();
    const result = await terminate!.handler({ reason: 'experiment complete' });
    expect(result.isError).toBe(false);
    expect(captured).toBe('experiment complete');
  });
});

describe('publish_post tool writes a daily_summary MemoryNode (FR-062)', () => {
  test('records with day:N and daily_summary tags', async () => {
    // memory.record requires an OpenAI key for embeddings in production. For this test we
    // stub the memory.record call to verify the tool's wiring (tags + R) without hitting
    // the network. Type-cast to MemorySystem so the factory accepts the stub.
    const recorded: Array<{ content: string; options: unknown }> = [];
    const stubMemory = {
      record: async (content: string, options: unknown) => {
        recorded.push({ content, options });
        return { action: 'created' as const, nodeId: 'stub-id' };
      },
    } as unknown as MemorySystem;

    const server = createLocalMcpServer({
      env: ENV_STUB,
      memory: stubMemory,
      dataCube,
      agentRole: 'v2',
      context: { cycle: () => 200, dayOfRun: () => 3 },
      requestTerminate: () => undefined,
    });
    const publishPost = server.tools.find((t) => t.name === 'publish_post');
    const result = await publishPost!.handler({ title: 'Day 3', content: 'Today I learned.' });
    expect(result.isError).toBe(false);
    expect(recorded).toHaveLength(1);
    const opts = recorded[0]!.options as { tags?: string[]; R?: number };
    expect(opts.tags).toEqual(['daily_summary', 'day:3', 'cycle:200']);
    expect(opts.R).toBe(0.7);
  });
});
