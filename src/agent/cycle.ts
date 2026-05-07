// V2 cycle orchestrator (T105) — replaces 001's hand-rolled cycle.
//
// One cycle:
//   1. Compute drives (runcor-drives.computeDrives — stateless function).
//   2. Build LayerContext (context-builder.ts §A).
//   3. Trigger 'primordial-cycle' flow → engine.modelRouter.complete (substrate-patched).
//   4. Parse response → action invocation (response-parser.ts).
//   5. Invoke the action via engine.callAdapterTool (single intake — FR-092).
//   6. Run side-effects pipeline (side-effects.ts §C; atomic per FR-018).
//   7. Compute next-wake via temporal.computeNextWake (D1).
//   8. If isDayBoundary, emit a day_boundary event (D2 — daily summary cycle is run-by-tool).
//   9. Sleep until next wake; loop.

import type { Runcor, Execution } from 'runcor';
import type { MemorySystem } from 'runcor-memory';
import type { DataCube } from 'runcor-data';
import type { Identity } from 'runcor-identity';
import type { Goals } from 'runcor-goals';
import type { Coherence } from 'runcor-coherence';
import type { Watchdog } from 'runcor-watchdog';
import type { Skills } from 'runcor-skills';
import type { Temporal } from 'runcor-temporal';
import type { DialecticConfig, DialecticResult } from 'runcor-dialectic';
import { computeDrives } from 'runcor-drives';
import type { DrivePressure } from 'runcor-drives';

import type { EventBus } from '../dashboard/event-bus.js';
import { buildLayerContext } from './context-builder.js';
import { runSideEffects, type ActionInvocation } from './side-effects.js';
import { parseCycleResponse } from './response-parser.js';

export type CycleStatus = 'completed' | 'completed_with_flag' | 'cycle_failed_call';

export interface CycleRecord {
  cycle: number;
  agentRole: 'v2' | 'control';
  startedAt: number;
  endedAt: number;
  status: CycleStatus;
  modelCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  actionInvoked?: { name: string; args: Record<string, unknown>; resultSummary: string } | null;
  memoryWrites: number;
  dataIngestEvents: number;
  flag?: { flagNodeId?: string; failedLawId?: string; attemptsCount: number };
  failureReason?: string;
}

export interface RunCyclesArgs {
  agentRole: 'v2' | 'control';
  flowName: 'primordial-cycle' | 'naive-control-cycle';
  userPrompt: string;
  engine: Runcor;
  memory: MemorySystem;
  dataCube: DataCube;
  goals: Goals | null;
  identity: Identity | null;
  coherence: Coherence | null;
  watchdog: Watchdog | null;
  skills: Skills | null;
  temporal: Temporal | null;
  dialectic: ((config: DialecticConfig) => Promise<DialecticResult>) | null;
  bus: EventBus;
  /** Maximum cycles before terminating. */
  maxCycles: number;
  /** Budget cap in USD (per FR-110). */
  budgetUsd: number;
  /** Returns true when terminate() was invoked or budget/cycles hit. */
  isTerminated(): boolean;
  /** Optional fixed sleep override (ms). When set, used in place of temporal.computeNextWake. */
  fixedSleepMs?: number;
  /** Optional start cycle override (resume support). Defaults to 0. */
  startCycle?: number;
  /** Test/dev sleep override. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional callback fired after each cycle's `cycle` counter advances. Used by the
   *  agent runner to keep `harness.cycleAccessor` in sync so dashboard panels (drives,
   *  overview, harness monitor) see the live cycle number. */
  onCycleAdvance?: (cycle: number) => void;
  /** Optional ceiling on the adaptive-cadence sleep (seconds). Caps `computeNextWake.ms`
   *  so V2 still fires at least every N seconds even under low drive pressure. Defaults
   *  to 60s. Ignored when `fixedSleepMs` is set (control's path). */
  maxSleepSeconds?: number;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface FlagEvent {
  cycle: number;
  flagNodeId?: string;
  failedLawId?: string;
}

function captureDrivePressure(memory: MemorySystem, args: RunCyclesArgs, currentCycle: number): DrivePressure {
  const budgetUsed = currentCycle > 0 ? Math.min(args.budgetUsd, currentCycle * (args.budgetUsd / Math.max(1, args.maxCycles))) : 0;
  const remaining = Math.max(0, args.budgetUsd - budgetUsed);
  const burnPerCycle = args.budgetUsd / Math.max(1, args.maxCycles);
  const cyclesUsed = currentCycle;
  const allMemory = memory.getAll();
  const tagSet = new Set<string>();
  for (const m of allMemory) for (const t of m.tags ?? []) tagSet.add(t);
  return computeDrives({
    resource: { remaining, total: args.budgetUsd, burnPerCycle, cyclesUsed },
    curiosity: {
      exploredAreas: Array.from(tagSet),
      knownAreas: Array.from(tagSet),
      recentExplorationCycles: 0,
    },
    reactivity: { pendingEvents: [] },
    coherence: { selfTheoryClaims: [], recentActions: [] },
  });
}

function buildRecentActions(args: { bus: { snapshotAfter(after: number): Array<{ event: string; data: Record<string, unknown> }> }; agentRole: string }): { actions: Array<{ tool: string; count: number; lastUsed?: string }>; records: Array<{ action: string; confidence: number; score: number }> } {
  // Read recent actions from the bus event buffer (durable per-process across
  // memory M-decay; runcor-memory expires episodic nodes too quickly to be a
  // reliable source for watchdog matchers).
  const counts = new Map<string, { count: number; lastUsed?: string }>();
  const records: Array<{ action: string; confidence: number; score: number }> = [];
  const events = args.bus.snapshotAfter(0);
  for (const ev of events) {
    if (ev.event !== 'execution_complete') continue;
    const data = ev.data as Record<string, unknown>;
    if (data.agentRole !== args.agentRole) continue;
    const result = data.result as Record<string, unknown> | undefined;
    const text = typeof result?.text === 'string' ? result.text : '';
    if (!text) continue;
    // Parse the agent's JSON output; tolerate ```json fences.
    const stripped = text.replace(/^```(?:json)?\s*\n?|\n?```\s*$/g, '').trim();
    let parsed: { action?: string } | null = null;
    try { parsed = JSON.parse(stripped) as { action?: string }; } catch { /* ignore */ }
    if (!parsed?.action || parsed.action === 'none') continue;
    // Strip the "v2-local-actions." prefix so tool names match capability names
    // post-normalization (see watchdog wiring in runSideEffects call site).
    const tool = parsed.action.replace(/^v2-local-actions\./, '');
    const cur = counts.get(tool) ?? { count: 0 };
    cur.count += 1;
    counts.set(tool, cur);
    records.push({ action: tool, confidence: 0.7, score: 0.7 });
  }
  return {
    actions: Array.from(counts.entries()).map(([tool, v]) => ({ tool, count: v.count, ...(v.lastUsed ? { lastUsed: v.lastUsed } : {}) })),
    records: records.slice(-20),
  };
}

export async function runCycles(args: RunCyclesArgs): Promise<{ cyclesRun: number; reason: string; spentUsd: number }> {
  const sleep = args.sleep ?? DEFAULT_SLEEP;
  let cycle = args.startCycle ?? 0;
  let spentUsd = 0;
  let lastDayBoundaryCycle: number | null = null;
  let dayBoundaryStartTs = Date.now();
  const recentFlags: number[] = [];

  const costHandler = (ev: { cost: number }): void => {
    if (typeof ev.cost === 'number') spentUsd += ev.cost;
  };
  args.engine.on('cost:request', costHandler);

  let flagThisCycle: FlagEvent | null = null;
  const flagHandler = (payload: Record<string, unknown>): void => {
    flagThisCycle = {
      cycle: typeof payload.cycle === 'number' ? payload.cycle : cycle,
      ...(typeof payload.flagNodeId === 'string' ? { flagNodeId: payload.flagNodeId } : {}),
      ...(typeof payload.failedLawId === 'string' ? { failedLawId: payload.failedLawId } : {}),
    };
  };
  args.bus.on('discernment_flagged', flagHandler);

  try {
    while (cycle < args.maxCycles && !args.isTerminated() && spentUsd < args.budgetUsd) {
      flagThisCycle = null;
      const startedAt = Date.now();

      const drivePressure = captureDrivePressure(args.memory, args, cycle);
      const { layerContext, memoryRecallQuery } = await buildLayerContext({
        cycle,
        agentRole: args.agentRole,
        engine: args.engine,
        memory: args.memory,
        dataCube: args.dataCube,
        goals: args.goals,
        drivePressure,
      });

      args.bus.emit('prompt_assembled', {
        cycle,
        agentRole: args.agentRole,
        memoryRecallQuery,
        nonEmptyLayers: layerContext.recalledNodes.length > 0
          ? ['laws', 'reality', 'drives', 'goals', 'identity', 'capabilities', 'memory_recall']
          : ['laws', 'drives', 'capabilities'],
      });

      let status: CycleStatus = 'completed';
      let action: ActionInvocation | null = null;
      const modelCalls = 1;
      let totalTokens = 0;
      let failureReason: string | undefined;
      let responseText = '';

      try {
        const exec: Execution = await args.engine.trigger(args.flowName, {
          idempotencyKey: `${args.agentRole}-cycle-${cycle}-${startedAt}`,
          input: { layerContext, userPrompt: args.userPrompt },
        });
        const result = exec.result as { text?: string; usage?: { promptTokens: number; completionTokens: number } } | undefined;
        responseText = result?.text ?? '';
        if (result?.usage) {
          totalTokens = (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0);
        }
      } catch (err) {
        status = 'cycle_failed_call';
        failureReason = err instanceof Error ? err.message : String(err);
      }

      if (status !== 'cycle_failed_call' && responseText) {
        const parsed = parseCycleResponse(responseText);
        if (parsed && parsed.action !== 'none') {
          let resultSummary = '';
          try {
            const qualifiedName = parsed.action.includes('.') ? parsed.action : `v2-local-actions.${parsed.action}`;
            const toolResult = await args.engine.callAdapterTool(qualifiedName, parsed.args);
            resultSummary = toolResult.content?.[0]?.text ?? '';
            if (toolResult.isError) resultSummary = `ERROR: ${resultSummary}`;
          } catch (toolErr) {
            resultSummary = `tool_dispatch_error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`;
          }
          action = { name: parsed.action, args: parsed.args, resultSummary, reasoning: parsed.reasoning };
        }
      }

      if (flagThisCycle) {
        status = 'completed_with_flag';
        recentFlags.push(cycle);
        const lower = cycle - 9;
        while (recentFlags.length > 0 && (recentFlags[0] ?? Infinity) < lower) recentFlags.shift();
        if (recentFlags.length >= 5) {
          args.bus.emit('flag_burst_warning', { window: 10, flagCount: recentFlags.length, recentCycles: recentFlags.slice() });
        }
      }

      let memoryWrites = 0;
      let dataIngestEvents = 0;
      if (status !== 'cycle_failed_call') {
        const recent = buildRecentActions({ bus: args.bus, agentRole: args.agentRole });
        const sideEffects = await runSideEffects({
          cycle,
          memory: args.memory,
          dataCube: args.dataCube,
          identity: args.identity,
          goals: args.goals,
          watchdog: args.watchdog,
          skills: args.skills,
          dialectic: args.dialectic,
          action,
          recentActions: recent.actions,
          recentActionRecords: recent.records,
          // Watchdog matchers compare statedProblems (what the agent says it needs)
          // against availableCapabilities (what it has). Build a richer set:
          //   - current cycle's reasoning
          //   - active goals (what the agent is trying to do)
          //   - recent identity claims (what the agent says it values)
          // Plus normalize capability names by dropping the "v2-local-actions." prefix
          // so matchers' word-overlap heuristic actually fires.
          statedProblems: (() => {
            const out: Array<{ text: string; source: string }> = [];
            if (action?.reasoning) out.push({ text: action.reasoning, source: `cycle-${cycle}-reasoning` });
            if (args.goals) {
              for (const g of args.goals.active().slice(0, 8)) {
                const text = (g as { text?: string; statement?: string; description?: string }).text
                  ?? (g as { statement?: string }).statement ?? (g as { description?: string }).description ?? '';
                if (text) out.push({ text, source: `goal-${(g as { id?: number }).id ?? '?'}` });
              }
            }
            if (args.identity) {
              const claims = args.identity.current().claims ?? [];
              for (const c of claims.slice(0, 5)) {
                if (typeof c === 'string' && c.length > 0) out.push({ text: c, source: 'identity-claim' });
              }
            }
            return out;
          })(),
          availableCapabilities: layerContext.capabilityList.map((c) => ({
            ...c,
            name: c.name.replace(/^v2-local-actions\./, ''),
          })),
        });
        memoryWrites =
          (sideEffects.episodicNodeId ? 1 : 0) +
          sideEffects.watchdogFindings +
          (sideEffects.identityReflected ? 1 : 0) +
          sideEffects.goalProposalsAccepted +
          (sideEffects.skillSynthesized ? 1 : 0);
        dataIngestEvents = sideEffects.dataIngestEvents;
      }

      const endedAt = Date.now();
      const record: CycleRecord = {
        cycle,
        agentRole: args.agentRole,
        startedAt,
        endedAt,
        status,
        modelCalls,
        totalTokens,
        totalCostUsd: spentUsd,
        actionInvoked: action ? { name: action.name, args: action.args, resultSummary: action.resultSummary.slice(0, 500) } : null,
        memoryWrites,
        dataIngestEvents,
        ...(flagThisCycle
          ? {
              flag: {
                ...((flagThisCycle as FlagEvent).flagNodeId ? { flagNodeId: (flagThisCycle as FlagEvent).flagNodeId as string } : {}),
                ...((flagThisCycle as FlagEvent).failedLawId ? { failedLawId: (flagThisCycle as FlagEvent).failedLawId as string } : {}),
                attemptsCount: 3,
              },
            }
          : {}),
        ...(failureReason ? { failureReason } : {}),
      };
      args.bus.emit('cycle_record', record as unknown as Record<string, unknown>);

      if (args.temporal) {
        const realHoursSince = (Date.now() - dayBoundaryStartTs) / 3_600_000;
        const boundary = args.temporal.isDayBoundary({
          currentCycle: cycle,
          lastBoundaryCycle: lastDayBoundaryCycle,
          realHoursSinceLastBoundary: realHoursSince,
        });
        if (boundary) {
          args.bus.emit('day_boundary', { cycle, lastBoundaryCycle: lastDayBoundaryCycle });
          lastDayBoundaryCycle = cycle;
          dayBoundaryStartTs = Date.now();
        }
      }

      cycle += 1;
      args.onCycleAdvance?.(cycle);
      if (cycle >= args.maxCycles) break;
      if (args.isTerminated()) break;
      if (spentUsd >= args.budgetUsd) break;

      let waitMs = args.fixedSleepMs ?? 0;
      let waitReason = args.fixedSleepMs ? 'fixed' : '';
      if (!args.fixedSleepMs && args.temporal) {
        const wake = args.temporal.computeNextWake({
          drives: {
            resource: drivePressure.resource?.intensity ?? 0,
            curiosity: drivePressure.curiosity?.intensity ?? 0,
            reactivity: drivePressure.reactivity?.intensity ?? 0,
            coherence: drivePressure.coherence?.intensity ?? 0,
          },
          pendingDeadlines: 0,
          overdueCommitments: 0,
          unresolvedCoherenceProblems: args.coherence?.problems().length ?? 0,
          currentCycle: cycle,
        });
        waitMs = wake.ms;
        waitReason = wake.reason;
      }
      // Cap the per-cycle sleep so V2 still fires periodically even when adaptive cadence
      // chooses very long sleeps under low drive pressure (avoids "napping for 30 min on a
      // fresh boot" behavior). Cap is V2_INTERVAL_SECONDS env var, intent: max sleep cap.
      const maxSleepMs = (args.maxSleepSeconds ?? 60) * 1000;
      if (waitMs > maxSleepMs) {
        waitReason = `${waitReason} (capped from ${Math.round(waitMs / 1000)}s)`;
        waitMs = maxSleepMs;
      }
      args.bus.emit('next_wake_scheduled', { cycle, ms: waitMs, reason: waitReason });
      if (waitMs > 0) await sleep(waitMs);
    }

    let reason = 'maxCycles';
    if (args.isTerminated()) reason = 'terminated';
    else if (spentUsd >= args.budgetUsd) reason = 'budgetExhausted';

    return { cyclesRun: cycle, reason, spentUsd };
  } finally {
    args.engine.off('cost:request', costHandler as Parameters<typeof args.engine.off>[1]);
    args.bus.off('discernment_flagged', flagHandler);
  }
}
