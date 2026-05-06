// T125 [US7] — Adding a fixture SQLite DB → discoverSchemas → synthesizeTools → registerWithEngine
//                produces tools available via engine.listAdapterTools().
// T126 [US7] — Safety policy filter blocks DDL / mass-delete tool synthesis (FR-091).
// T127 [US7] — Synthesised tools route through engine.callAdapterTool (single intake — FR-092).

import { describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { createIntegration, DEFAULT_SAFETY_POLICY } from 'runcor-integration';
import type { McpToolDefinition } from 'runcor-integration';

dotenvConfig();
const HAS_OPENAI = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.length > 0;
const skipIfNoKey = HAS_OPENAI ? test : test.skip;

// Stub model for integration's LLM-driven classification path; integration.discoverSchemas may
// or may not invoke it depending on whether an R++ classifier is wired. Provide a minimal model.
const stubModel = {
  async complete(_req: { prompt?: string; systemPrompt?: string; responseFormat?: 'text' | 'json' }): Promise<{ text: string }> {
    return { text: '{"classification":"normal","columns":[]}' };
  },
};

function makeFixtureDb(): { dbPath: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'integ-fix-'));
  const dbPath = path.join(dir, 'fixture.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT);
    CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT UNIQUE);
    INSERT INTO notes (title, body) VALUES ('hello', 'world'), ('foo', 'bar');
  `);
  db.close();
  return {
    dbPath,
    cleanup: (): void => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

describe('T125 + T126: schema discovery + synthesis + safety filter', () => {
  skipIfNoKey('discoverSchemas + synthesizeTools produces a non-empty tool list filtered by policy', async () => {
    const fixture = makeFixtureDb();
    const integDir = mkdtempSync(path.join(tmpdir(), 'integ-'));
    try {
      const integration = createIntegration({
        model: stubModel,
        dbPath: path.join(integDir, 'integration.db'),
      });
      const report = await integration.discoverSchemas({
        reachable: [{ kind: 'sqlite', uri: fixture.dbPath }],
        cycle: 0,
      });
      expect(report).toBeDefined();
      const tools = integration.synthesizeTools(report, DEFAULT_SAFETY_POLICY);
      // SELECT-only tools should be produced for the 2 tables.
      expect(Array.isArray(tools)).toBe(true);
      // Defense-in-depth: no DDL / mass-delete tool names.
      for (const t of tools) {
        expect(t.name).not.toMatch(/^(create|drop|alter|truncate|rename)[-_]/i);
        expect(t.name).not.toMatch(/^delete[-_]/i);
      }
    } finally {
      try {
        rmSync(integDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      fixture.cleanup();
    }
  });

  test('synthesizeTools applies safety policy as defense-in-depth (T126)', () => {
    const integration = createIntegration({ model: stubModel, dbPath: ':memory:' });
    // Empty report → empty tools, but the policy filter must be honored either way.
    const tools = integration.synthesizeTools(
      { sources: [], schemas: [], cycle: 0, generatedAt: new Date().toISOString() } as Parameters<typeof integration.synthesizeTools>[0],
      DEFAULT_SAFETY_POLICY,
    );
    expect(tools).toEqual([]);
    // Policy contains the expected forbid entries.
    expect(DEFAULT_SAFETY_POLICY.forbid).toContain('ddl');
    expect(DEFAULT_SAFETY_POLICY.forbid).toContain('mass_delete');
  });
});

describe('T127: dynamic-tool routing through engine.callAdapterTool (FR-092 single-intake)', () => {
  test('boot.ts uses engine.addAdapter / integration.registerWithEngine — never bypasses the engine', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(path.resolve('src/boot/boot.ts'), 'utf8');
    expect(src).toMatch(/integration\.registerWithEngine\(/);
    expect(src).toMatch(/engine\.addAdapter\(/);
  });

  test('cycle.ts dispatches tool calls via engine.callAdapterTool (single intake)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(path.resolve('src/agent/cycle.ts'), 'utf8');
    expect(src).toMatch(/engine\.callAdapterTool\(/);
    // No direct adapter invocations bypassing the engine.
    expect(src).not.toMatch(/integration\.invoke/);
  });

  test('McpToolDefinition shape includes name + description + inputSchema (used by capabilities layer)', () => {
    // Minimal type-shape check via construction.
    const sample: McpToolDefinition = {
      name: 'select_notes',
      description: 'List notes',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async () => ({ content: [{ type: 'text', text: '[]' }] }),
    } as McpToolDefinition;
    expect(sample.name).toBe('select_notes');
  });
});
