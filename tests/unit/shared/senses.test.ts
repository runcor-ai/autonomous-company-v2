import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { httpFetch, createFsReader, createClock, createMockInboxReader, webSearch } from '../../../src/shared/senses/index.js';

function mockFetch(text: string, status = 200, headers: Record<string, string> = {}): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: new Headers(headers),
  } as Response)) as unknown as typeof fetch;
}

describe('http_fetch', () => {
  it('returns body + headers + status', async () => {
    const r = await httpFetch({ url: 'http://example.com' }, mockFetch('hello world', 200, { 'x-y': 'z' }));
    expect(r.status).toBe(200);
    expect(r.body).toBe('hello world');
    expect(r.headers['x-y']).toBe('z');
  });

  it('truncates body at maxBytes', async () => {
    const big = 'x'.repeat(1000);
    const r = await httpFetch({ url: 'http://example.com', maxBytes: 100 }, mockFetch(big));
    expect(r.body.length).toBe(100);
    expect(r.truncated).toBe(true);
  });
});

describe('fs_read', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fsread-'));
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('reads files within bounded root', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'contents-a');
    const r = createFsReader(tmp);
    const out = await r.read({ relativePath: 'a.txt' });
    expect(out.content).toBe('contents-a');
    expect(out.byteCount).toBe(10);
  });

  it('rejects path that escapes root via ..', async () => {
    const r = createFsReader(tmp);
    await expect(r.read({ relativePath: '../../etc/passwd' })).rejects.toThrow(/escapes bounded root/);
  });

  it('lists directory entries', async () => {
    await fs.writeFile(path.join(tmp, 'a'), '');
    await fs.mkdir(path.join(tmp, 'sub'));
    const r = createFsReader(tmp);
    const list = await r.list('.');
    expect(list.sort()).toEqual(['a', 'sub/']);
  });
});

describe('inbox_read (mock)', () => {
  it('returns mocked messages', async () => {
    const reader = createMockInboxReader([
      { uid: 1, from: 'a@b.c', to: 'runner@runcor.ai', subject: 'hi', date: '2026-01-01', preview: 'hello', unread: true },
    ]);
    const msgs = await reader.read();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.subject).toBe('hi');
  });
});

describe('time/clock', () => {
  it('now returns ISO + day-of-week', () => {
    const c = createClock(() => new Date('2026-05-05T12:00:00Z'));
    const snap = c.now();
    expect(snap.utcDay).toBe('2026-05-05');
    expect(snap.dayOfWeek).toBe('Tuesday');
    expect(snap.utcHour).toBe(12);
  });

  it('cyclesSince computes elapsed cycles', () => {
    const c = createClock(() => new Date('2026-05-05T12:00:00Z'));
    expect(c.cyclesSince('2026-05-05T11:00:00Z', 60 * 5)).toBe(12); // 60min / 5min = 12
  });
});

describe('web_search (mock provider)', () => {
  it('routes to a caller-provided provider', async () => {
    const r = await webSearch({ query: 'q' }, async () => ({
      query: 'q', provider: 'mock',
      hits: [{ title: 't', url: 'http://u', snippet: 's' }],
    }));
    expect(r.hits).toHaveLength(1);
    expect(r.provider).toBe('mock');
  });
});
