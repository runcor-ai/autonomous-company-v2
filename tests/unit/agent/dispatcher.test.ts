// Coverage for dispatcher behaviors not exercised by integration tests:
//   - web_scrape success path (Firecrawl mock)
//   - fetch_chunk slicing of a previous cycle's stored result
//   - fs_write schema-error message when caller uses wrong field name
//   - schedule_self exposes a consumable wake via dispatcher.scheduler

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Store } from '../../../src/shared/db.js';
import { createDispatcher } from '../../../src/agent/dispatcher.js';

function mockFirecrawl(markdown: string): typeof fetch {
  return (async () => ({
    ok: true, status: 200,
    text: async () => '',
    json: async () => ({ success: true, data: { markdown, metadata: { title: 'mock' } } }),
  } as Response)) as unknown as typeof fetch;
}

describe('dispatcher — web_scrape', () => {
  let tmp: string; let store: Store;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'disp-'));
    store = new Store(':memory:');
  });
  afterEach(async () => { store.close(); await fs.rm(tmp, { recursive: true, force: true }); });

  it('returns clean markdown via Firecrawl scraper', async () => {
    const d = createDispatcher({
      store, publicUrlPrefix: 'http://x', fsRoot: tmp,
      firecrawlApiKey: 'k', fetchImpl: mockFirecrawl('# Title\n\nbody'),
    });
    const r = await d.execute('web_scrape', { url: 'http://x' });
    expect(r.success).toBe(true);
    expect((r.result as { markdown: string }).markdown).toContain('# Title');
  });

  it('errors clearly when Firecrawl key absent', async () => {
    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const r = await d.execute('web_scrape', { url: 'http://x' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/FIRECRAWL_API_KEY/);
  });
});

describe('dispatcher — fetch_chunk', () => {
  let tmp: string; let store: Store;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'disp-'));
    store = new Store(':memory:');
  });
  afterEach(async () => { store.close(); await fs.rm(tmp, { recursive: true, force: true }); });

  it('slices a previous cycle action result with hasMore flag', async () => {
    const cycle = store.startCycle('v2', 5);
    store.completeCycle(cycle.id, 'complete');
    const big = 'A'.repeat(20_000);
    store.recordAction('v2', cycle.id, 'web_scrape', { url: 'x' }, { result: big });

    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const r = await d.execute('fetch_chunk', { cycle: 5, start: 0, length: 8000 });
    expect(r.success).toBe(true);
    const out = r.result as { chunk: string; hasMore: boolean; total: number };
    // Stored result is JSON-stringified, so total is big.length + 2 quotes.
    expect(out.total).toBeGreaterThanOrEqual(20_000);
    expect(out.chunk.length).toBe(8000);
    expect(out.hasMore).toBe(true);
  });

  it('errors when the cycle does not exist', async () => {
    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const r = await d.execute('fetch_chunk', { cycle: 999 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cycle 999 not found/);
  });
});

describe('dispatcher — fs_write schema errors', () => {
  let tmp: string; let store: Store;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'disp-'));
    store = new Store(':memory:');
  });
  afterEach(async () => { store.close(); await fs.rm(tmp, { recursive: true, force: true }); });

  it('rejects "data" field with explicit schema-correction message', async () => {
    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const r = await d.execute('fs_write', { path: 'note.md', data: 'oops' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/payload field must be "content"/);
  });

  it('rejects missing path with the full schema in the message', async () => {
    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const r = await d.execute('fs_write', { content: 'hi' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/path/);
    expect(r.error).toMatch(/content/);
  });
});

describe('dispatcher — schedule_self exposed via dispatcher.scheduler', () => {
  let tmp: string; let store: Store;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'disp-'));
    store = new Store(':memory:');
  });
  afterEach(async () => { store.close(); await fs.rm(tmp, { recursive: true, force: true }); });

  it('runner can consume the wake after schedule_self', async () => {
    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const wakeAt = new Date(Date.now() + 60_000).toISOString();
    const r = await d.execute('schedule_self', { wakeAt, reason: 'check inbox' });
    expect(r.success).toBe(true);

    const next = d.scheduler.consumeNext();
    expect(next?.wakeAt).toBe(wakeAt);
    expect(next?.reason).toBe('check inbox');
    // Once consumed, the queue is empty.
    expect(d.scheduler.consumeNext()).toBeNull();
  });

  it('accepts delay_seconds shorthand', async () => {
    const d = createDispatcher({ store, publicUrlPrefix: 'http://x', fsRoot: tmp });
    const r = await d.execute('schedule_self', { delay_seconds: 30 });
    expect(r.success).toBe(true);
    expect(d.scheduler.nextWake()).not.toBeNull();
  });
});
