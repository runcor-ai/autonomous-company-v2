// Naive control runner (T112) — entry point for the control process.
//
// Boots the same engine + substrate (Principle VI: same rails) but with `cognitiveDisabled: true`,
// so identity / goals / coherence / watchdog / skills / dialectic are NOT constructed (FR-101).
// The control's cycle uses fixed cadence (FR-105) and the frozen control-config.json prompt seed
// (Principle X). All outward-action surfaces are identical to V2's.

import { boot } from '../boot/boot.js';
import { runCycles } from './cycle.js';
import { subscribeEngineTelemetry } from '../engine/telemetry.js';

export interface ControlRunResult {
  cyclesRun: number;
  reason: string;
  totalSpentUsd: number;
}

export interface RunControlOptions {
  /** Optional shared event bus — when V2 and control co-run in one process, V2 passes its bus
   *  here so control's cycle/cost events surface on the same dashboard. Defaults to control's
   *  own bus when omitted (standalone-process mode). */
  sharedBus?: import('../dashboard/event-bus.js').EventBus;
  /** Optional callback invoked once control's harness is booted, so the caller (e.g. V2's runAgent)
   *  can wire control's memory/dataCube/cycleAccessor into the dashboard for /memory?role=control,
   *  /data?role=control, and /overview?role=control panels. */
  onBooted?: (h: { memory: unknown; dataCube: unknown; getCycle: () => number }) => void;
}

export async function runControl(opts: RunControlOptions = {}): Promise<ControlRunResult> {
  const harness = await boot({ agentRole: 'control', cognitiveDisabled: true });
  if (!harness.controlConfig) {
    throw new Error('control-config.json not found — control cannot start without the frozen Principle X config');
  }
  if (opts.onBooted) opts.onBooted({
    memory: harness.memory,
    dataCube: harness.dataCube,
    getCycle: () => harness.cycleAccessor.get(),
  });
  const bus = opts.sharedBus ?? harness.bus;

  // Boot already subscribed engine telemetry to control's local bus. When a sharedBus
  // is provided (V2 co-process mode), ALSO subscribe to the shared bus so the V2
  // dashboard receives control's cost_request / execution_complete / etc. events
  // tagged with agentRole='control'.
  if (opts.sharedBus && opts.sharedBus !== harness.bus) {
    subscribeEngineTelemetry({ engine: harness.engine, bus: opts.sharedBus, agentRole: 'control' });
  }

  try {
    const result = await runCycles({
      agentRole: 'control',
      flowName: 'naive-control-cycle',
      userPrompt: harness.controlConfig.config.playerSystemPrompt,
      engine: harness.engine,
      memory: harness.memory,
      dataCube: harness.dataCube,
      goals: null,
      identity: null,
      coherence: null,
      watchdog: null,
      skills: null,
      temporal: harness.temporal,
      dialectic: null,
      bus,
      maxCycles: harness.env.maxCycles,
      budgetUsd: harness.controlConfig.config.budgetUsd,
      isTerminated: harness.terminationState.isTerminated,
      fixedSleepMs: harness.controlConfig.config.cadenceMs, // FR-105 fixed cadence
      onCycleAdvance: (c: number) => harness.cycleAccessor.set(c),
    });
    return { cyclesRun: result.cyclesRun, reason: result.reason, totalSpentUsd: result.spentUsd };
  } finally {
    harness.temporal.close();
    await harness.engine.shutdown();
  }
}
