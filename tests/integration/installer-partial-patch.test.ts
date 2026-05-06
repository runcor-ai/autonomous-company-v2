// T168 [US1] — Boot guard fails closed when substrate's installer is partially engaged
// (spec Edge Cases §"Substrate installer fails partway"; FR-012; addresses C7).
//
// Scenario: a third party (or a buggy retry) replaces engine.modelRouter.complete after
// the substrate installed → the patched method's brand symbol is gone → assertInstallerEngaged
// detects this and throws.

import { describe, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { Substrate } from 'runcor-substrate';
import { assertInstallerEngaged, InstallerNotEngagedError } from '../../src/boot/installer-check.js';

interface FakeEngine extends EventEmitter {
  modelRouter: {
    complete: (...args: unknown[]) => Promise<unknown>;
  };
}

function makeEngine(): FakeEngine {
  const e = new EventEmitter() as FakeEngine;
  e.modelRouter = {
    complete: async (): Promise<{ text: string }> => ({ text: 'baseline' }),
  };
  return e;
}

describe('T168: partial-patch detection (FR-012)', () => {
  test('installer.install + immediate assertInstallerEngaged passes', () => {
    const substrate = new Substrate();
    const engine = makeEngine();
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    expect(() =>
      assertInstallerEngaged({
        installer: substrate.installer,
        engine: engine as unknown as { modelRouter: { complete: unknown } },
      }),
    ).not.toThrow();
  });

  test('after install, replacing modelRouter.complete with an unbranded function fails the guard', () => {
    const substrate = new Substrate();
    const engine = makeEngine();
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);

    // Simulate a third party (a re-import path, a retry-wrapper bug) overwriting the patched
    // method with a plain function — the brand symbol is gone.
    engine.modelRouter.complete = async (): Promise<{ text: string }> => ({ text: 'tampered' });

    expect(() =>
      assertInstallerEngaged({
        installer: substrate.installer,
        engine: engine as unknown as { modelRouter: { complete: unknown } },
      }),
    ).toThrow(InstallerNotEngagedError);
  });

  test('uninstall returns to original; subsequent guard call throws (no brand)', () => {
    const substrate = new Substrate();
    const engine = makeEngine();
    substrate.installer.install(engine as unknown as Parameters<typeof substrate.installer.install>[0]);
    substrate.installer.uninstall(engine as unknown as Parameters<typeof substrate.installer.uninstall>[0]);
    expect(() =>
      assertInstallerEngaged({
        installer: substrate.installer,
        engine: engine as unknown as { modelRouter: { complete: unknown } },
      }),
    ).toThrow(InstallerNotEngagedError);
  });
});
