// Substrate engagement check (T053, FR-012).
//
// Verifies that `substrate.installer.install(engine)` actually patched the engine's
// `modelRouter.complete`. The check is two-pronged:
//
// 1. `installer.isInstalled(engine)` — substrate's own lifecycle predicate, returns true
//    iff THIS installer has installed AND the patched method still carries our brand
//    (no third party has overwritten it).
//
// 2. Brand-symbol probe — defense-in-depth: re-confirm the brand directly. If a future
//    substrate revision changes the brand semantics, this surfaces immediately rather than
//    the agent appearing to work while bypassing the gate.
//
// The full retry-then-flag smoke test (synthetic discernment-failing call → 3 attempts →
// flag MemoryNode → best-of-three return) lives in the integration test suite
// (`tests/integration/retry-then-flag.spec.ts`) — it requires a real model call which we
// don't want on every boot for cost reasons. The boot guard's contract per research.md §R4
// is "verify the verdict comes through", and the brand probe verifies the patched method
// is in place. Bypass detection at boot is the goal; full behavioral coverage is the
// test suite's.

import type { SubstrateInstaller } from 'runcor-substrate';

const INSTALLED_MARKER = Symbol.for('runcor-substrate/installed');

export interface InstallerCheckArgs {
  installer: SubstrateInstaller;
  /** The runcor `Runcor` instance — typed loosely so we don't need a runtime import here. */
  engine: { modelRouter?: { complete: unknown } };
}

export class InstallerNotEngagedError extends Error {
  constructor(reason: string) {
    super(`Substrate installer not engaged on engine: ${reason}`);
    this.name = 'InstallerNotEngagedError';
  }
}

/**
 * Throws `InstallerNotEngagedError` if the substrate's installer is not engaged on the
 * engine. Returns nothing on success.
 */
export function assertInstallerEngaged({ installer, engine }: InstallerCheckArgs): void {
  if (!engine.modelRouter || typeof engine.modelRouter.complete !== 'function') {
    throw new InstallerNotEngagedError('engine.modelRouter.complete is not a function');
  }

  if (!installer.isInstalled(engine as Parameters<SubstrateInstaller['isInstalled']>[0])) {
    throw new InstallerNotEngagedError('installer.isInstalled(engine) returned false');
  }

  const branded = (engine.modelRouter.complete as unknown as { [k: symbol]: unknown })[INSTALLED_MARKER];
  if (branded !== true) {
    throw new InstallerNotEngagedError(
      'engine.modelRouter.complete is not branded with runcor-substrate/installed — a third party has replaced the patched method',
    );
  }
}
