import { describe, it, expect } from 'vitest';
import { Store } from '../../src/shared/db.js';
import { bootHarness, closeHarness, type DialecticLike } from '../../src/agent/boot.js';
import { isDayBoundary, reflectAndPublish } from '../../src/agent/daily.js';

function mockDialectic(answer = 'observing the void; nothing eventful happened.'): DialecticLike {
  return async () => ({ answer });
}

describe('isDayBoundary', () => {
  it('first day-end fires when cycle count reaches cyclesPerDay', () => {
    const store = new Store(':memory:');
    store.startCycle('v2', 0);
    expect(isDayBoundary(199, store, { cyclesPerDay: 200 })).toBe(false);
    expect(isDayBoundary(200, store, { cyclesPerDay: 200 })).toBe(true);
    store.close();
  });

  it('first day-end fires when msPerDay elapses since cycle 0', () => {
    const store = new Store(':memory:');
    store.startCycle('v2', 0);
    const future = new Date(Date.now() + 25 * 60 * 60 * 1000);
    expect(isDayBoundary(50, store, { cyclesPerDay: 200, msPerDay: 24 * 60 * 60 * 1000, now: () => future })).toBe(true);
    store.close();
  });

  it('subsequent day-ends fire when cyclesPerDay since last summary', () => {
    const store = new Store(':memory:');
    store.startCycle('v2', 0);
    store.addSummary('v2', 1, 'first day');
    expect(isDayBoundary(399, store, { cyclesPerDay: 200 })).toBe(false);
    expect(isDayBoundary(400, store, { cyclesPerDay: 200 })).toBe(true);
    store.close();
  });
});

describe('reflectAndPublish', () => {
  it('produces a summary record and a public URL for day N+1', async () => {
    const store = new Store(':memory:');
    const harness = bootHarness({ dialectic: mockDialectic('day one in 80 words.') });
    store.startCycle('v2', 0);
    const out = await reflectAndPublish({
      store, harness, cycleEnd: 199,
      publicUrlPrefix: 'http://localhost:8080',
    });
    expect(out.dayNumber).toBe(1);
    expect(out.text).toContain('day one');
    expect(out.publicUrl).toBe('http://localhost:8080/blog/v2/day-1');
    expect(store.summariesFor('v2')).toHaveLength(1);
    closeHarness(harness);
    store.close();
  });

  it('day numbers increment across multiple invocations', async () => {
    const store = new Store(':memory:');
    const harness = bootHarness({ dialectic: mockDialectic() });
    store.startCycle('v2', 0);
    const a = await reflectAndPublish({ store, harness, cycleEnd: 199, publicUrlPrefix: 'http://x' });
    const b = await reflectAndPublish({ store, harness, cycleEnd: 399, publicUrlPrefix: 'http://x' });
    expect(a.dayNumber).toBe(1);
    expect(b.dayNumber).toBe(2);
    closeHarness(harness);
    store.close();
  });
});

// NOTE: end-to-end runAgent + day-boundary integration is covered by experiment.test.ts.
// A separate test file mixing runAgent + multiple bootHarness instances + day-boundary
// reflection consistently triggered a vitest worker-pool crash with native better-sqlite3
// — covered upstream in the orchestration test instead.
