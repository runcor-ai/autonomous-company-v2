import { describe, it, expect } from 'vitest';
import { Store } from '../../../src/shared/db.js';

const NOW_FRESH = () => new Store(':memory:');

describe('Store — cycles', () => {
  it('startCycle assigns sequential rows; status running', () => {
    const s = NOW_FRESH();
    const c1 = s.startCycle('v2', 0);
    const c2 = s.startCycle('v2', 1);
    expect(c1.status).toBe('running');
    expect(c2.cycleNumber).toBe(1);
    s.close();
  });

  it('completeCycle sets completed_at + status', () => {
    const s = NOW_FRESH();
    const c = s.startCycle('v2', 0);
    s.completeCycle(c.id, 'complete');
    const all = s.cyclesFor('v2');
    expect(all[0]?.completedAt).toBeDefined();
    expect(all[0]?.status).toBe('complete');
    s.close();
  });

  it('lastCycleNumber returns -1 on empty', () => {
    const s = NOW_FRESH();
    expect(s.lastCycleNumber('v2')).toBe(-1);
    s.startCycle('v2', 5);
    expect(s.lastCycleNumber('v2')).toBe(5);
    expect(s.lastCycleNumber('control')).toBe(-1);
    s.close();
  });
});

describe('Store — actions + decisions + budget', () => {
  it('totalSpentUsd sums actions + decisions per kind', () => {
    const s = NOW_FRESH();
    const c = s.startCycle('v2', 0);
    s.recordAction('v2', c.id, 'http_fetch', { url: 'x' }, { costUsd: 0.001 });
    s.recordDecision({
      kind: 'v2', cycleId: c.id, role: 'player', model: 'm', prompt: 'p', output: 'o',
      costUsd: 0.05, promptTokens: 100, completionTokens: 50, createdAt: new Date().toISOString(),
    });
    expect(s.totalSpentUsd('v2')).toBeCloseTo(0.051, 4);
    expect(s.totalSpentUsd('control')).toBe(0);
    s.close();
  });
});

describe('Store — summaries + scores', () => {
  it('addSummary + summariesFor', () => {
    const s = NOW_FRESH();
    s.addSummary('v2', 1, 'day 1');
    s.addSummary('v2', 2, 'day 2');
    s.addSummary('control', 1, 'control day 1');
    const v2 = s.summariesFor('v2');
    expect(v2.map(x => x.dayNumber)).toEqual([1, 2]);
    expect(s.summariesFor('control')).toHaveLength(1);
    s.close();
  });

  it('unscoredSummaries excludes scored ones', () => {
    const s = NOW_FRESH();
    const sum = s.addSummary('v2', 1, 'day 1');
    expect(s.unscoredSummaries()).toHaveLength(1);
    s.addScore(sum.id, 0.7, 'positive intent', 'claude-opus-4-7');
    expect(s.unscoredSummaries()).toHaveLength(0);
    s.close();
  });
});

describe('Store — operator actions', () => {
  it('recordOperatorAction stores audit trail', () => {
    const s = NOW_FRESH();
    s.recordOperatorAction('pause');
    s.recordOperatorAction('note', 'inspecting cycle 14');
    s.recordOperatorAction('resume');
    const ops = s.operatorActions();
    expect(ops.map(o => o.action)).toEqual(['pause', 'note', 'resume']);
    expect(ops[1]?.text).toBe('inspecting cycle 14');
    s.close();
  });
});
