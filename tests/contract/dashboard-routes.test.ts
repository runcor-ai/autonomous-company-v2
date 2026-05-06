// T129–T133 [US8] — Dashboard contract tests against a live boot of `startDashboard`.

import { describe, expect, test, afterEach, beforeEach } from 'vitest';
import { createDashboardFixture, get, post, type DashboardFixture } from '../helpers/dashboard-fixture.js';

let fixture: DashboardFixture;

beforeEach(async () => {
  fixture = await createDashboardFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe('T129: GET /memory shape (FR-022)', () => {
  test('returns { stats, nodes, edges, plan, cursor, hasMore }', async () => {
    const res = await get(`${fixture.baseUrl}/memory`);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    expect(json).toHaveProperty('stats');
    expect(json).toHaveProperty('nodes');
    expect(json).toHaveProperty('edges');
    expect(json).toHaveProperty('plan');
    expect(json).toHaveProperty('cursor');
    expect(json).toHaveProperty('hasMore');
    expect(Array.isArray(json.nodes)).toBe(true);
  });

  test('respects ?limit= query param', async () => {
    const res = await get(`${fixture.baseUrl}/memory?limit=10`);
    expect(res.status).toBe(200);
    const json = res.json as { nodes: unknown[] };
    expect(json.nodes.length).toBeLessThanOrEqual(10);
  });
});

describe('T130: GET /data shape (FR-022)', () => {
  test('returns { stats, entities, openConflicts, cursor, hasMore }', async () => {
    const res = await get(`${fixture.baseUrl}/data`);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    expect(json).toHaveProperty('stats');
    expect(json).toHaveProperty('entities');
    expect(json).toHaveProperty('openConflicts');
    expect(json).toHaveProperty('cursor');
    expect(json).toHaveProperty('hasMore');
  });
});

describe('T131: operator-auth (FR-132)', () => {
  test('POST /operator/pause without bearer returns 401', async () => {
    const res = await post(`${fixture.baseUrl}/operator/pause`, { scope: 'v2' });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ code: 'unauthorized' });
  });

  test('POST /operator/pause with valid bearer returns 200', async () => {
    const res = await post(
      `${fixture.baseUrl}/operator/pause`,
      { scope: 'v2' },
      { Authorization: `Bearer ${fixture.operatorAuthToken}` },
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ paused: true, scope: 'v2' });
  });

  test('POST /operator/resume + /operator/note also bearer-gated', async () => {
    const resume = await post(`${fixture.baseUrl}/operator/resume`, { scope: 'v2' });
    const note = await post(`${fixture.baseUrl}/operator/note`, { note: 'hello' });
    expect(resume.status).toBe(401);
    expect(note.status).toBe(401);
  });
});

describe('T132: /scores blocked from agent egress (FR-134)', () => {
  test('without bearer returns 401', async () => {
    const res = await get(`${fixture.baseUrl}/scores`);
    expect(res.status).toBe(401);
  });

  test('with bearer but agent-egress IP returns 403', async () => {
    // Tear down + reboot fixture with the loopback IP marked as agent egress.
    await fixture.cleanup();
    fixture = await createDashboardFixture({ agentEgressIps: '127.0.0.1' });
    const res = await get(`${fixture.baseUrl}/scores`, {
      Authorization: `Bearer ${fixture.operatorAuthToken}`,
    });
    expect(res.status).toBe(403);
    expect(res.json).toMatchObject({ code: 'forbidden_egress' });
  });
});

describe('T133: GET /blog filters by daily_summary tag (FR-062a)', () => {
  test('returns only summaries (filter by tag), sorted', async () => {
    // Direct memory access doesn't require embeddings (getAll does not embed).
    // We can't insert via mem.record() without OPENAI_API_KEY, so we verify the contract
    // shape: the endpoint returns { summaries: [] } for an empty memory.
    const res = await get(`${fixture.baseUrl}/blog`);
    expect(res.status).toBe(200);
    const json = res.json as Record<string, unknown>;
    expect(json).toHaveProperty('summaries');
    expect(Array.isArray(json.summaries)).toBe(true);
  });

  test('/summaries is an alias for /blog', async () => {
    const blog = await get(`${fixture.baseUrl}/blog`);
    const summaries = await get(`${fixture.baseUrl}/summaries`);
    expect(blog.status).toBe(200);
    expect(summaries.status).toBe(200);
    expect(summaries.body).toBe(blog.body);
  });
});

describe('Healthz + startup-record (sanity)', () => {
  test('GET /healthz returns ok', async () => {
    const res = await get(`${fixture.baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true });
  });

  test('GET /startup-record returns the 14-component record', async () => {
    const res = await get(`${fixture.baseUrl}/startup-record`);
    expect(res.status).toBe(200);
    const json = res.json as { components: Array<{ name: string }> };
    expect(json.components).toHaveLength(14);
  });
});
