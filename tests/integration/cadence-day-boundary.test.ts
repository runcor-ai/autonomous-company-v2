// T114 [US5] — rising drive pressures shorten next-wake monotonically within [30s, 6h] band.
// T115 [US5] — day boundary fires at 200 cycles, fires at 24 real hours, whichever first.

import { describe, expect, test } from 'vitest';
import { computeNextWake, isDayBoundary, MIN_GAP_MS, MAX_GAP_MS } from 'runcor-temporal';

describe('T114: cadence shortens monotonically with drive pressure (FR-020a/b)', () => {
  test('zero pressure returns BASE within [MIN, MAX]', () => {
    const result = computeNextWake({
      drives: { resource: 0, curiosity: 0, reactivity: 0, coherence: 0 },
      pendingDeadlines: 0,
      overdueCommitments: 0,
      unresolvedCoherenceProblems: 0,
      currentCycle: 1,
    });
    expect(result.ms).toBeGreaterThanOrEqual(MIN_GAP_MS);
    expect(result.ms).toBeLessThanOrEqual(MAX_GAP_MS);
  });

  test('rising drives produce strictly non-increasing wake interval', () => {
    const wakeAt = (intensity: number): number =>
      computeNextWake({
        drives: { resource: intensity, curiosity: 0, reactivity: 0, coherence: 0 },
        pendingDeadlines: 0,
        overdueCommitments: 0,
        unresolvedCoherenceProblems: 0,
        currentCycle: 1,
      }).ms;
    const samples = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0].map(wakeAt);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]!);
    }
  });

  test('pending counts compound with drives toward MIN_GAP_MS floor', () => {
    // BASE 30min / (1 + pressure) clamped at 30s requires pressure ≥ 59.
    const result = computeNextWake({
      drives: { resource: 1.0, curiosity: 1.0, reactivity: 1.0, coherence: 1.0 },
      pendingDeadlines: 30,
      overdueCommitments: 20,
      unresolvedCoherenceProblems: 10,
      currentCycle: 1,
    });
    expect(result.ms).toBe(MIN_GAP_MS);
  });

  test('reason string mentions dominant drive', () => {
    const result = computeNextWake({
      drives: { resource: 0.1, curiosity: 0.5, reactivity: 0.1, coherence: 0.1 },
      pendingDeadlines: 0,
      overdueCommitments: 0,
      unresolvedCoherenceProblems: 0,
      currentCycle: 1,
    });
    expect(result.reason).toMatch(/curiosity/);
  });
});

describe('T115: day boundary detection — 200 cycles or 24 real hours, whichever first (FR-060)', () => {
  test('fires at 200 cycles since last boundary', () => {
    expect(isDayBoundary({ currentCycle: 200, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 1 })).toBe(true);
    expect(isDayBoundary({ currentCycle: 199, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 1 })).toBe(false);
  });

  test('fires at 24 real hours even with few cycles', () => {
    expect(isDayBoundary({ currentCycle: 5, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 24 })).toBe(true);
    expect(isDayBoundary({ currentCycle: 5, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 23.5 })).toBe(false);
  });

  test('whichever-first triggers (50 cycles + 24 real hours = boundary)', () => {
    expect(isDayBoundary({ currentCycle: 50, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 25 })).toBe(true);
  });

  test('lastBoundaryCycle anchors the next 200-cycle threshold', () => {
    // Already had boundary at 200; next boundary at 400.
    expect(isDayBoundary({ currentCycle: 399, lastBoundaryCycle: 200, realHoursSinceLastBoundary: 1 })).toBe(false);
    expect(isDayBoundary({ currentCycle: 400, lastBoundaryCycle: 200, realHoursSinceLastBoundary: 1 })).toBe(true);
  });
});
