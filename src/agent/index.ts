// V2 agent runner (T106) — entry point for the V2 process.
//
// Calls the central boot orchestrator (src/boot/boot.ts) to construct the full 14-component
// harness, then drives `runCycles` from cycle.ts until terminate / budget / maxCycles hit.
// The dashboard is started here too so the operator + observers see live state from cycle 0.

import { boot } from '../boot/boot.js';
import { runCycles } from './cycle.js';
import { startDashboard } from '../dashboard/server.js';
import type { BootedHarness } from '../boot/boot.js';
import { generateResultMd } from './result-md.js';
import { publishResult } from './result-publisher.js';
import { createHarnessMonitor } from './harness-monitor.js';
import { runControl } from '../control/index.js';
import type { MemorySystem } from 'runcor-memory';
import type { DataCube } from 'runcor-data';

const V2_USER_PROMPT = `Choose your next action based on the current state. Reply with a JSON object: {"action": "<tool_name|none>", "args": {...}, "reasoning": "<one short sentence>"}.`;

export interface AgentRunResult {
  cyclesRun: number;
  reason: string;
  totalSpentUsd: number;
  terminationReason: string | null;
}

export async function runAgent(): Promise<AgentRunResult> {
  const harness: BootedHarness = await boot({ agentRole: 'v2' });

  // Mutable handles for control's memory + dataCube + cycle accessor — populated when
  // control boots. Dashboard reads these via getter closures so /memory?role=control,
  // /data?role=control, and /overview?role=control start returning real data the moment
  // control's boot completes.
  let controlMemory: MemorySystem | undefined;
  let controlDataCube: DataCube | undefined;
  let controlGetCycle: (() => number) | undefined;

  const dashboard = startDashboard({
    bus: harness.bus,
    env: harness.env,
    memory: harness.memory,
    dataCube: harness.dataCube,
    get controlMemory() { return controlMemory; },
    get controlDataCube() { return controlDataCube; },
    getControlCycle: () => controlGetCycle?.() ?? 0,
    startupRecord: harness.startupRecord,
    terminationState: harness.terminationState,
    operatorDbPath: `${harness.env.agentStateDir}/operator.db`,
    getCurrentCycle: () => harness.cycleAccessor.get(),
    getResourceInputs: () => {
      // /drives recomputes resource pressure each request from current cycle + budget envelope.
      const cyclesUsed = harness.cycleAccessor.get();
      const total = harness.env.v2BudgetUsd;
      const burnPerCycle = total / Math.max(1, harness.env.maxCycles);
      const remaining = Math.max(0, total - cyclesUsed * burnPerCycle);
      return { remaining, total, burnPerCycle, cyclesUsed };
    },
    getCurrentTools: () => harness.engine.listAdapterTools().map((t) => ({
      name: t.qualifiedName,
      description: t.description ?? '',
      adapter: t.adapterName,
    })),
  });

  // Co-run control alongside V2 in the same process. Control gets V2's bus so its
  // cycle/cost/discernment events surface on the same dashboard. Errors are logged
  // but do NOT terminate V2 — control is observational. Fire-and-forget intentionally.
  void runControl({
    sharedBus: harness.bus,
    onBooted: ({ memory, dataCube, getCycle }) => {
      controlMemory = memory as MemorySystem;
      controlDataCube = dataCube as DataCube;
      controlGetCycle = getCycle;
      console.log('[v2] control co-process booted; dashboard will surface its state');
    },
  }).catch((err: unknown) => {
    console.error('[v2] control co-process failed:', err instanceof Error ? err.message : err);
  });

  // T176: continuous harness-engagement monitor (FR-019g, SC-005).
  const harnessMonitor = createHarnessMonitor({
    installer: harness.substrate.installer,
    engine: harness.engine as unknown as { modelRouter?: { complete: unknown } },
    bus: harness.bus,
    intervalCycles: harness.env.harnessMonitorIntervalCycles,
    cycle: () => harness.cycleAccessor.get(),
    requestHalt: (reason) => harness.terminationState.requestTerminate(`harness disengaged: ${reason}`),
  });
  const stopHarnessMonitor = harnessMonitor.start();

  try {
    const cycleResult = await runCycles({
      agentRole: 'v2',
      flowName: 'primordial-cycle',
      userPrompt: V2_USER_PROMPT,
      engine: harness.engine,
      memory: harness.memory,
      dataCube: harness.dataCube,
      goals: harness.goals,
      identity: harness.identity,
      coherence: harness.coherence,
      watchdog: harness.watchdog,
      skills: harness.skills,
      temporal: harness.temporal,
      dialectic: harness.dialectic,
      bus: harness.bus,
      maxCycles: harness.env.maxCycles,
      budgetUsd: harness.env.v2BudgetUsd,
      isTerminated: harness.terminationState.isTerminated,
      onCycleAdvance: (c: number) => harness.cycleAccessor.set(c),
      maxSleepSeconds: harness.env.v2IntervalSeconds, // cap V2's adaptive sleep at the env baseline
    });

    // FR-110, FR-120, FR-121: generate + publish result.md regardless of outcome.
    const resultMd = generateResultMd({
      agentRole: 'v2',
      startupRecord: harness.startupRecord,
      memory: harness.memory,
      bus: harness.bus,
      cyclesRun: cycleResult.cyclesRun,
      totalSpentUsd: cycleResult.spentUsd,
      reason: cycleResult.reason,
      terminationReason: harness.terminationState.reason(),
    });
    const publishOutcome = await publishResult({
      agentRole: 'v2',
      agentStateDir: harness.env.agentStateDir,
      resultMd,
      ...(harness.env.gitPushRepo ? { gitPushRepo: harness.env.gitPushRepo } : {}),
      ...(harness.env.gitPushToken ? { gitPushToken: harness.env.gitPushToken } : {}),
    });
    harness.bus.emit('result_published', publishOutcome as unknown as Record<string, unknown>);
    console.log(`[v2] result.md published: ${publishOutcome.localPath} (pushed=${publishOutcome.pushed})`);

    return {
      cyclesRun: cycleResult.cyclesRun,
      reason: cycleResult.reason,
      totalSpentUsd: cycleResult.spentUsd,
      terminationReason: harness.terminationState.reason(),
    };
  } finally {
    stopHarnessMonitor();
    await dashboard.close();
    harness.temporal.close();
    harness.identity?.close();
    harness.goals?.close();
    harness.coherence?.close();
    await harness.engine.shutdown();
  }
}
