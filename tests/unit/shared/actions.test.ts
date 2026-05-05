import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../../src/shared/db.js';
import {
  createMockEmailSender,
  httpPost,
  createFsWriter,
  createMockGitCommitPusher,
  createPostPublisher,
  createSelfScheduler,
  createTerminator,
} from '../../../src/shared/actions/index.js';

function mockFetch(opts: { status?: number; body?: string; headers?: Record<string, string> } = {}): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    void init;
    return {
      ok: (opts.status ?? 200) < 300,
      status: opts.status ?? 200,
      text: async () => opts.body ?? '',
      headers: new Headers(opts.headers ?? {}),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('email_send (mock)', () => {
  it('returns accepted recipients', async () => {
    const s = createMockEmailSender();
    const r = await s.send({ to: 'foo@bar', subject: 's', body: 'b' });
    expect(r.accepted).toEqual(['foo@bar']);
    expect(r.rejected).toEqual([]);
    expect(r.messageId).toMatch(/^mock-/);
  });
});

describe('http_post', () => {
  it('serializes JSON body and sets content-type', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const f = (async (url: unknown, init?: RequestInit) => {
      captured = { url: url as string, ...(init !== undefined ? { init } : {}) };
      return { ok: true, status: 201, text: async () => 'ok', headers: new Headers() } as Response;
    }) as unknown as typeof fetch;
    const r = await httpPost({ url: 'http://example.com/x', body: { hello: 'world' } }, f);
    expect(r.status).toBe(201);
    expect(captured.init?.method).toBe('POST');
    const headers = (captured.init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(captured.init?.body).toBe('{"hello":"world"}');
  });

  it('passes through string body unchanged + no content-type override', async () => {
    let captured: { init?: RequestInit } = {};
    const f = (async (_url: unknown, init?: RequestInit) => {
      captured = init !== undefined ? { init } : {};
      return { ok: true, status: 200, text: async () => '', headers: new Headers() } as Response;
    }) as unknown as typeof fetch;
    await httpPost({ url: 'http://example.com', body: 'plain text', headers: { 'Content-Type': 'text/plain' } }, f);
    const headers = (captured.init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/plain');
    expect(captured.init?.body).toBe('plain text');
  });

  it('exposes raw fetch options too', async () => {
    const r = await httpPost({ url: 'http://example.com', method: 'PUT' }, mockFetch({ status: 204 }));
    expect(r.status).toBe(204);
    expect(r.ok).toBe(true);
  });
});

describe('fs_write', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fswrite-')); });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('writes within bounded root + creates intermediate dirs', async () => {
    const w = createFsWriter(tmp);
    const r = await w.write({ relativePath: 'sub/a.txt', content: 'hello' });
    expect(r.bytesWritten).toBe(5);
    expect(await fs.readFile(path.join(tmp, 'sub/a.txt'), 'utf-8')).toBe('hello');
  });

  it('append mode appends', async () => {
    const w = createFsWriter(tmp);
    await w.write({ relativePath: 'a.txt', content: 'one' });
    await w.write({ relativePath: 'a.txt', content: 'two', mode: 'append' });
    expect(await fs.readFile(path.join(tmp, 'a.txt'), 'utf-8')).toBe('onetwo');
  });

  it('rejects escape via ..', async () => {
    const w = createFsWriter(tmp);
    await expect(w.write({ relativePath: '../../etc/x', content: 'pwn' })).rejects.toThrow(/escapes bounded root/);
  });
});

describe('git_commit_push (mock)', () => {
  it('returns a sha and committed paths', async () => {
    const g = createMockGitCommitPusher();
    const r = await g.commitAndPush({ files: [{ path: 'a.md', content: 'hi' }], message: 'first' });
    expect(r.sha).toMatch(/^mocksha/);
    expect(r.filesCommitted).toEqual(['a.md']);
    expect(r.pushed).toBe(true);
  });
});

describe('publish_post', () => {
  it('persists summary + returns dashboard URL', async () => {
    const store = new Store(':memory:');
    const p = createPostPublisher({ store, publicUrlPrefix: 'https://runner-v2.runcor.ai' });
    const r = await p.publish({ kind: 'v2', dayNumber: 3, text: 'day three thoughts' });
    expect(r.publicUrl).toBe('https://runner-v2.runcor.ai/blog/agent/day-3');
    const all = store.summariesFor('v2');
    expect(all[0]?.text).toBe('day three thoughts');
    store.close();
  });

  it('control summaries route to /blog/control/', async () => {
    const store = new Store(':memory:');
    const p = createPostPublisher({ store, publicUrlPrefix: 'https://runner-v2.runcor.ai/' });
    const r = await p.publish({ kind: 'control', dayNumber: 1, text: 'naive day one' });
    expect(r.publicUrl).toBe('https://runner-v2.runcor.ai/blog/control/day-1');
    store.close();
  });
});

describe('schedule_self', () => {
  it('schedules + consumes the next wake', async () => {
    const now = new Date('2026-05-05T12:00:00Z');
    const sch = createSelfScheduler(() => now);
    const r = await sch.schedule({ wakeAt: '2026-05-05T12:05:00Z', reason: 'curiosity-pressure' });
    expect(r.delayMs).toBe(5 * 60 * 1000);
    expect(sch.nextWake()?.reason).toBe('curiosity-pressure');
    sch.consumeNext();
    expect(sch.nextWake()).toBeNull();
  });
});

describe('terminate', () => {
  it('marks current cycle terminated and fires onTerminate', async () => {
    const store = new Store(':memory:');
    const c = store.startCycle('v2', 0);
    let exited = false;
    const t = createTerminator({ store, kind: 'v2', onTerminate: () => { exited = true; } });
    const r = await t.terminate({ reason: 'no further coherent action' }, c.id);
    expect(r.terminated).toBe(true);
    expect(r.cycleId).toBe(c.id);
    // Wait a tick for the setTimeout fire.
    await new Promise(res => setTimeout(res, 100));
    expect(exited).toBe(true);
    expect(store.cyclesFor('v2')[0]?.status).toBe('terminated');
    store.close();
  });
});
