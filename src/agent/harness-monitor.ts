// Continuous harness-engagement monitor (T176, FR-019g, SC-005, addresses C5).
//
// Periodically re-runs the boot's installer-engaged check (assertInstallerEngaged) plus
// a 14-component liveness ping. Emits `harness_engaged` / `harness_disengaged` telemetry.
// On disengagement, signals the cycle loop to halt pending operator review.
//
// Cadence: HARNESS_MONITOR_INTERVAL_CYCLES env var (default 100). The monitor is started
// by agent/index.ts after boot, runs alongside the cycle loop, stops on terminate.

import type { SubstrateInstaller } from 'runcor-substrate';
import type { EventBus } from '../dashboard/event-bus.js';
import type { CanonicalComponentName } from '../boot/components.js';
import { CANONICAL_COMPONENTS } from '../boot/components.js';
import { assertInstallerEngaged, InstallerNotEngagedError } from '../boot/installer-check.js';

export interface HarnessMonitorArgs {
  installer: SubstrateInstaller;
  engine: { modelRouter?: { complete: unknown } };
  bus: EventBus;
  /** Components the monitor should liveness-ping. Skipped when undefined for minimal mode. */
  components?: Partial<Record<CanonicalComponentName, { ping(): boolean | Promise<boolean> }>>;
  intervalCycles: number;
  cycle(): number;
  /** Set to true to signal the cycle loop should stop after this cycle. */
  requestHalt(reason: string): void;
}

export interface HarnessMonitor {
  /** Run one check immediately. Used at boot for the very first assertion. */
  checkNow(): Promise<{ engaged: boolean; reason?: string; failedComponents?: string[] }>;
  /** Start the periodic loop. Returns a stop function. */
  start(): () => void;
}

export function createHarnessMonitor(args: HarnessMonitorArgs): HarnessMonitor {
  let timer: NodeJS.Timeout | null = null;
  let lastCheckCycle = -1;

  async function checkNow(): Promise<{ engaged: boolean; reason?: string; failedComponents?: string[] }> {
    try {
      assertInstallerEngaged({ installer: args.installer, engine: args.engine });
    } catch (err) {
      const reason = err instanceof InstallerNotEngagedError ? err.message : err instanceof Error ? err.message : String(err);
      return { engaged: false, reason };
    }
    const failed: string[] = [];
    if (args.components) {
      for (const name of CANONICAL_COMPONENTS) {
        const c = args.components[name];
        if (!c) continue;
        try {
          const ok = await c.ping();
          if (!ok) failed.push(name);
        } catch (err) {
          failed.push(`${name} (${err instanceof Error ? err.message : 'unknown'})`);
        }
      }
    }
    if (failed.length > 0) {
      return { engaged: false, reason: 'component_liveness_failed', failedComponents: failed };
    }
    return { engaged: true };
  }

  function tick(): void {
    const now = args.cycle();
    if (now - lastCheckCycle < args.intervalCycles) return;
    lastCheckCycle = now;
    void checkNow().then((result) => {
      if (result.engaged) {
        args.bus.emit('harness_engaged', { cycle: now });
      } else {
        args.bus.emit('harness_disengaged', { cycle: now, reason: result.reason ?? '', failedComponents: result.failedComponents ?? [] });
        args.requestHalt(result.reason ?? 'harness_disengaged');
      }
    });
  }

  return {
    checkNow,
    start(): () => void {
      timer = setInterval(tick, 1_000);
      return () => {
        if (timer) clearInterval(timer);
        timer = null;
      };
    },
  };
}
