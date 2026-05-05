// Read-only state panels — JSON endpoints for cognitive state.

import type { KindContext } from '../types.js';

export function memoryPanel(ctx: KindContext, currentCycle: number): unknown {
  const cycles = ctx.store.cyclesFor('v2').length;
  const totalActions = ctx.store.cyclesFor('v2')
    .reduce((s, c) => s + ctx.store.actionsFor(c.id).length, 0);
  const totalDecisions = ctx.store.cyclesFor('v2')
    .reduce((s, c) => s + ctx.store.decisionsFor(c.id).length, 0);
  void currentCycle;
  return { cyclesPersisted: cycles, totalActions, totalDecisions };
}

export function identityPanel(ctx: KindContext): unknown {
  if (!ctx.harness) return { error: 'harness not in-process' };
  try {
    const current = ctx.harness.identity.current() as unknown;
    const block = ctx.harness.identity.renderBlock();
    const versionCount = ctx.harness.identity.count();
    return { current, block, versionCount };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function goalsPanel(ctx: KindContext, currentCycle: number): unknown {
  if (!ctx.harness) return { error: 'harness not in-process' };
  const stack = ctx.harness.goals.stack(currentCycle) as unknown;
  const block = ctx.harness.goals.renderBlock(currentCycle);
  return { stack, block };
}

export function drivesPanel(ctx: KindContext, currentCycle: number): unknown {
  if (!ctx.harness) return { error: 'harness not in-process' };
  const remaining = Math.max(0, ctx.budget.capUsd - ctx.budget.spentUsd());
  const burn = 0.005;
  const drives = ctx.harness.drivesCompute({
    resource: { remaining, total: ctx.budget.capUsd, burnPerCycle: burn, cyclesUsed: currentCycle },
  });
  return drives;
}

export function watchdogPanel(ctx: KindContext): unknown {
  // Watchdog has no DB — findings are stored alongside cycle records (Phase 5).
  // For Phase 4 we return a snapshot of recent action / cycle counts as a proxy for "still observing".
  if (!ctx.harness) return { error: 'harness not in-process' };
  const cycles = ctx.store.cyclesFor('v2');
  const recent = cycles.slice(-10);
  return {
    observedCycles: cycles.length,
    recentActions: recent.flatMap(c => ctx.store.actionsFor(c.id)).map(a => ({
      cycle: a.cycleId, action: a.action, ts: a.createdAt,
    })),
  };
}

export function coherencePanel(ctx: KindContext): unknown {
  if (!ctx.harness) return { error: 'harness not in-process' };
  const state = ctx.harness.coherence.state();
  const block = ctx.harness.coherence.renderBlock();
  return { state, block };
}

export function summariesPanel(ctx: KindContext, kind: 'v2' | 'control'): unknown {
  return ctx.store.summariesFor(kind);
}

/** Aggregated overview — small payload for at-a-glance polling. */
export function overviewPanel(ctx: KindContext, kind: 'v2' | 'control'): unknown {
  const cycles = ctx.store.cyclesFor(kind);
  const last = cycles[cycles.length - 1];
  const status = last ? last.status : 'not-started';
  const summaries = ctx.store.summariesFor(kind);
  const lastSummaryDay = summaries[summaries.length - 1]?.dayNumber ?? null;
  return {
    kind,
    cycleCount: cycles.length,
    lastCycleStatus: status,
    spentUsd: ctx.budget.spentUsd(),
    capUsd: ctx.budget.capUsd,
    summariesPublished: summaries.length,
    lastSummaryDay,
  };
}
