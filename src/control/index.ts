// Naive control runner (T112) — entry point for the control process.
//
// Boots the same engine + substrate (Principle VI: same rails) but with `cognitiveDisabled: true`,
// so identity / goals / coherence / watchdog / skills / dialectic are NOT constructed (FR-101).
// The control's cycle uses fixed cadence (FR-105) and the frozen control-config.json prompt seed
// (Principle X). All outward-action surfaces are identical to V2's.

import { boot } from '../boot/boot.js';
import { runCycles } from './cycle.js';

export interface ControlRunResult {
  cyclesRun: number;
  reason: string;
  totalSpentUsd: number;
}

export async function runControl(): Promise<ControlRunResult> {
  const harness = await boot({ agentRole: 'control', cognitiveDisabled: true });
  if (!harness.controlConfig) {
    throw new Error('control-config.json not found — control cannot start without the frozen Principle X config');
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
      bus: harness.bus,
      maxCycles: harness.env.maxCycles,
      budgetUsd: harness.controlConfig.config.budgetUsd,
      isTerminated: harness.terminationState.isTerminated,
      fixedSleepMs: harness.controlConfig.config.cadenceMs, // FR-105 fixed cadence
    });
    return { cyclesRun: result.cyclesRun, reason: result.reason, totalSpentUsd: result.spentUsd };
  } finally {
    harness.temporal.close();
    await harness.engine.shutdown();
  }
}
