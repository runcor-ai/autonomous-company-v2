// V2 agent runner (T106) — entry point for the V2 process.
//
// Calls the central boot orchestrator (src/boot/boot.ts) to construct the full 14-component
// harness, then drives `runCycles` from cycle.ts until terminate / budget / maxCycles hit.
// The dashboard is started here too so the operator + observers see live state from cycle 0.

import { boot } from '../boot/boot.js';
import { runCycles } from './cycle.js';
import { startDashboard } from '../dashboard/server.js';
import type { BootedHarness } from '../boot/boot.js';

const V2_USER_PROMPT = `Choose your next action based on the current state. Reply with a JSON object: {"action": "<tool_name|none>", "args": {...}, "reasoning": "<one short sentence>"}.`;

export interface AgentRunResult {
  cyclesRun: number;
  reason: string;
  totalSpentUsd: number;
  terminationReason: string | null;
}

export async function runAgent(): Promise<AgentRunResult> {
  const harness: BootedHarness = await boot({ agentRole: 'v2' });

  const dashboard = startDashboard({
    bus: harness.bus,
    env: harness.env,
    memory: harness.memory,
    dataCube: harness.dataCube,
    startupRecord: harness.startupRecord,
    terminationState: harness.terminationState,
    operatorDbPath: `${harness.env.agentStateDir}/operator.db`,
  });

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
    });

    return {
      cyclesRun: cycleResult.cyclesRun,
      reason: cycleResult.reason,
      totalSpentUsd: cycleResult.spentUsd,
      terminationReason: harness.terminationState.reason(),
    };
  } finally {
    await dashboard.close();
    harness.temporal.close();
    harness.identity?.close();
    harness.goals?.close();
    harness.coherence?.close();
    await harness.engine.shutdown();
  }
}
