// T177 — continuous harness-engagement monitor (FR-019g, SC-005).

import { describe, expect, test } from 'vitest';
import { createHarnessMonitor } from '../../src/agent/harness-monitor.js';
import { EventBus } from '../../src/dashboard/event-bus.js';

const INSTALLED_MARKER = Symbol.for('runcor-substrate/installed');

function makeEngagedEngine(): { modelRouter: { complete: () => void } } {
  const fn = () => undefined;
  Object.defineProperty(fn, INSTALLED_MARKER, { value: true });
  return { modelRouter: { complete: fn } };
}

function makeDisengagedEngine(): { modelRouter: { complete: () => void } } {
  return { modelRouter: { complete: () => undefined } }; // no brand
}

describe('HarnessMonitor.checkNow', () => {
  test('returns engaged when installer + brand pass', async () => {
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof createHarnessMonitor>[0]['installer'];
    const monitor = createHarnessMonitor({
      installer,
      engine: makeEngagedEngine(),
      bus: new EventBus(),
      intervalCycles: 1,
      cycle: () => 1,
      requestHalt: () => undefined,
    });
    const result = await monitor.checkNow();
    expect(result.engaged).toBe(true);
  });

  test('returns disengaged when brand missing', async () => {
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof createHarnessMonitor>[0]['installer'];
    const monitor = createHarnessMonitor({
      installer,
      engine: makeDisengagedEngine(),
      bus: new EventBus(),
      intervalCycles: 1,
      cycle: () => 1,
      requestHalt: () => undefined,
    });
    const result = await monitor.checkNow();
    expect(result.engaged).toBe(false);
    expect(result.reason).toContain('not branded');
  });

  test('disengagement triggers requestHalt', async () => {
    let halted = false;
    let haltReason = '';
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof createHarnessMonitor>[0]['installer'];
    const bus = new EventBus();
    const monitor = createHarnessMonitor({
      installer,
      engine: makeDisengagedEngine(),
      bus,
      intervalCycles: 1,
      cycle: () => 1,
      requestHalt: (reason) => {
        halted = true;
        haltReason = reason;
      },
    });
    // Manually trigger the periodic tick by starting + immediately checking
    const events: unknown[] = [];
    bus.on('harness_disengaged', (data) => events.push(data));
    const stop = monitor.start();
    await new Promise((r) => setTimeout(r, 1100));
    stop();
    expect(halted).toBe(true);
    expect(haltReason).toBeTruthy();
    expect(events.length).toBeGreaterThan(0);
  });
});
