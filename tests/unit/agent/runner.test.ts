// Unit tests for runAgent's adaptive cadence + scheduler-aware sleep + loop
// detection in the cycle prompt.

import { describe, it, expect } from 'vitest';
import { computeNextSleepMs } from '../../../src/agent/index.js';
import { assembleCyclePrompt } from '../../../src/agent/prompts/cycle_prompt.js';
import type { ActionDispatcher } from '../../../src/agent/dispatcher.js';

function fakeDispatcher(scheduled: { wakeAt: string; reason?: string } | null): ActionDispatcher {
  let pending = scheduled;
  return {
    isSense: () => false,
    execute: async () => ({ success: true, result: null }),
    scheduler: {
      schedule: async () => ({ scheduledFor: '', delayMs: 0 }),
      nextWake: () => pending,
      consumeNext: () => { const p = pending; pending = null; return p; },
    },
  };
}

describe('computeNextSleepMs — adaptive cadence', () => {
  it('uses base * 2 when drives are calm (max < 0.3)', () => {
    const ms = computeNextSleepMs({ baseSeconds: 30, maxDriveIntensity: 0.1 });
    expect(ms).toBe(60_000);
  });

  it('uses base * 0.5 when drives are urgent (max >= 0.7)', () => {
    const ms = computeNextSleepMs({ baseSeconds: 30, maxDriveIntensity: 0.8 });
    expect(ms).toBe(15_000);
  });

  it('uses base unchanged at moderate pressure', () => {
    const ms = computeNextSleepMs({ baseSeconds: 30, maxDriveIntensity: 0.5 });
    expect(ms).toBe(30_000);
  });

  it('clamps to a 5s minimum even if math says less', () => {
    // base 8s × 0.5 = 4s → clamped up to 5s.
    const ms = computeNextSleepMs({ baseSeconds: 8, maxDriveIntensity: 0.9 });
    expect(ms).toBe(5_000);
  });
});

describe('computeNextSleepMs — scheduler override', () => {
  it('honors a future schedule_self wake (clamped to base*60 ceiling)', () => {
    const now = 1_000_000_000_000;
    const wakeAt = new Date(now + 10_000).toISOString(); // 10s out
    const dispatcher = fakeDispatcher({ wakeAt });
    const ms = computeNextSleepMs({
      baseSeconds: 30, maxDriveIntensity: 0.5, dispatcher, nowFn: () => now,
    });
    // 10s requested; base=30s × 60 ceiling = 1800s → 10_000 stays.
    expect(ms).toBe(10_000);
  });

  it('clamps insanely-far wake down to base * 60', () => {
    const now = 1_000_000_000_000;
    const wakeAt = new Date(now + 86_400_000).toISOString(); // 1 day out
    const dispatcher = fakeDispatcher({ wakeAt });
    const ms = computeNextSleepMs({
      baseSeconds: 30, maxDriveIntensity: 0.5, dispatcher, nowFn: () => now,
    });
    expect(ms).toBe(30 * 60 * 1000);
  });

  it('falls through to adaptive cadence when wake is in the past', () => {
    const now = 1_000_000_000_000;
    const wakeAt = new Date(now - 5_000).toISOString();
    const dispatcher = fakeDispatcher({ wakeAt });
    const ms = computeNextSleepMs({
      baseSeconds: 30, maxDriveIntensity: 0.1, dispatcher, nowFn: () => now,
    });
    expect(ms).toBe(60_000); // calm-pressure path
  });

  it('consumes the wake (subsequent calls fall through)', () => {
    const now = 1_000_000_000_000;
    const wakeAt = new Date(now + 10_000).toISOString();
    const dispatcher = fakeDispatcher({ wakeAt });
    computeNextSleepMs({ baseSeconds: 30, maxDriveIntensity: 0.5, dispatcher, nowFn: () => now });
    const second = computeNextSleepMs({ baseSeconds: 30, maxDriveIntensity: 0.5, dispatcher, nowFn: () => now });
    expect(second).toBe(30_000); // base, not 10s
  });
});

describe('cycle prompt — surfaces watchdog signals + loop warning', () => {
  const baseInput = {
    cycleNumber: 12,
    drives: { summary: 's', maxIntensity: 0.4 } as never,
    drivesText: 'no pressure',
    identityText: '(none)',
    goalsText: '(none)',
    capabilities: { senses: ['time'], actions: ['terminate'] },
  };

  it('renders a WATCHDOG SIGNALS block when findings present', () => {
    const out = assembleCyclePrompt({
      ...baseInput,
      watchdogFindings: [{
        category: 'unused-capability-matching-stated-problem',
        capability: 'web_search',
        problem: 'I should research the report',
        dialecticReason: 'agent stated intent but never invoked any sense',
      }],
    });
    expect(out).toMatch(/WATCHDOG SIGNALS/);
    expect(out).toMatch(/web_search/);
    expect(out).toMatch(/agent stated intent/);
  });

  it('renders a loop warning when supplied', () => {
    const out = assembleCyclePrompt({
      ...baseInput,
      loopWarning: 'You picked time {} 3 cycles in a row.',
    });
    expect(out).toMatch(/LOOP DETECTED/);
    expect(out).toMatch(/3 cycles in a row/);
  });

  it('omits both blocks when neither is provided', () => {
    const out = assembleCyclePrompt(baseInput);
    expect(out).not.toMatch(/WATCHDOG SIGNALS/);
    expect(out).not.toMatch(/LOOP DETECTED/);
  });
});
