# Contract: Sibling API Bindings

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**Audience**: V2 implementers writing boot wiring + cycle protocol

This contract pins every sibling API V2 calls. Each binding shows the call signature, where in V2 source it's invoked, and the FR(s) it satisfies. Citations are file:line where the API exists today, or `(scaffold)` if it's part of a Phase-0 sibling extension or new-repo scaffold.

## Boot order (single source of truth)

V2's `src/boot/boot.ts` MUST execute these steps sequentially. Failure of any step fails the boot (FR-011, FR-012).

1. Load `.env`; validate required keys present (`shared/env.ts`).
2. Verify all 14 sibling packages resolve via `import` — fail with named-component error if not (FR-011).
3. Construct providers: OpenRouter provider for `runcor`'s model router.
4. Construct engine: `createEngine(config, [openRouterProvider])` → `Runcor` instance (`runcor/src/index.ts:3`).
5. Construct memory: `new MemorySystem({ db, config, model })` (`runcor-memory/src/memory-system.ts:38`).
6. Construct data cube: `new DataCube({ db })` *(scaffold — research.md §R5)*.
7. Construct integration: `new Integration({ engine })` *(scaffold — research.md §R6)*.
8. Construct substrate: `createSubstrate({ laws, dataCubeReader: dataCube, layers: [...] })` *(scaffold — research.md §R3)*.
9. Install substrate: `substrate.installer.install(engine)`; assert `substrate.installer.isInstalled(engine) === true` (FR-012).
10. Construct cognitive components with memory injection (per R8):
    - `createIdentity({ memory })` (R8 extension)
    - `createGoals({ memory })` (R8 extension)
    - `createCoherence({ memory })` (R8 extension)
    - `createTemporal()` (no memory injection needed; deadlines are not memory)
    - `createWatchdog()`, `createSkills()`, `createMeta()` — stateless, no special wiring
    - dialectic + drives are stateless functions, no construction
11. Boot local MCP server: `mcpLocal = createLocalMcpServer({ tools: [...] })`; `engine.addAdapter(mcpLocal.asAdapterConfig())`.
12. Run integration discovery once: `await integration.discoverSchemas({ reachable: configuredSources })`; synthesise + register tools.
13. Health-check: invoke `engine.modelRouter.complete(...)` with a discernment-failing dummy → assert verdict comes through.
14. Build `StartupRecord` with all 14 components + their pinned versions + health status. Publish to dashboard.
15. Subscribe to engine events for telemetry (research.md §R13).
16. Start cycle loop.

## Per-cycle protocol

V2's `src/agent/cycle.ts` runs this protocol. Each numbered call below is a binding.

### A. Build context (before model call)

A1. **Get current drive pressures** (stateless):
```ts
import { computeDrives, renderPressureBlock } from 'runcor-drives';
const drives = computeDrives({ memory, temporal });
// drives: { resource, curiosity, reactivity, coherence, dominant: { label, value } }
```
*Source*: `runcor-drives/src/index.ts` — verified stateless module.

A2. **Get top goal**:
```ts
const topGoal = goals.top();        // PlanItem | null
```
*Source*: extended `runcor-goals` post-R8.

A3. **Get last plan** (for memory recall query):
```ts
const lastPlan = memory.getPlan(); // Plan | null
```
*Source*: `runcor-memory/src/memory-system.ts:38-454` (`getPlan()` exists today).

A4. **Build memory recall query** (FR-076 template):
```ts
const queryText = `Goal: ${topGoal?.text ?? ''}. Drive: ${drives.dominant.label}. Last plan: ${lastPlan?.strategy?.slice(0,200) ?? ''}.`;
const recalled = await memory.query(queryText, /* topK comes from memory's config, not passed here */);
```
*Source*: `runcor-memory/src/ctx-memory.ts` (verified `memory.query(text, topK)` exists; topK has a default).
*FR*: FR-076.

A5. **Get latest identity self-theory**:
```ts
const identityNodes = memory.getAll().filter(n => n.tags?.includes('identity_snapshot')).sort((a,b) => b.created_cycle - a.created_cycle);
const identityText = identityNodes[0]?.content ?? null;
```
*Source*: `runcor-memory/src/memory-system.ts` (`getAll()` exists). Tag scheme per R8.
*Note*: Once `memory.findByTag(tag)` lands as a sibling extension, switch to it for perf.

A6. **Get capability list**:
```ts
const capabilities = engine.listAdapterTools();   // ToolInfo[]
```
*Source*: `runcor/src/engine.ts:1169` (`listAdapterTools()` exists).

A7. **Assemble cycle context** for the substrate's prompt-stack:
```ts
const layerContext: LayerContext = {
  cycle: currentCycle,
  agentRole: 'v2',           // 'control' for the control process
  baseRequest,
  drives,
  topGoal,
  identitySelfTheory: identityText,
  lastPlanPrécis: lastPlan?.strategy?.slice(0,200) ?? null,
  recalledNodes: recalled,
  realitySlice: dataCube.query({ goal: topGoal?.text, drive: drives.dominant.label }),
  capabilityList: capabilities,
};
```

### B. Invoke the cycle flow

B1. **Trigger primordial-cycle flow**:
```ts
const execution = await engine.trigger('primordial-cycle', {
  idempotencyKey: `v2-cycle-${currentCycle}`,
  input: { layerContext },
});
```
*Source*: `runcor/src/engine.ts:648`.

The flow handler (registered at boot) calls `engine.modelRouter.complete(...)`. Substrate's installer intercepts: prepends layered prompt, runs discernment gate post-call. On retry exhaustion, throws `DiscernmentUnresolved` (research.md §R4) — caught by the cycle protocol's outer try/catch.

### C. Side effects (atomic — only on `execution.status === 'complete'`)

C1. **Episodic memory write** (FR-070):
```ts
await memory.record(
  `Cycle ${currentCycle}: invoked ${actionName}(${argsJson}); result: ${resultSummary}; reasoning: ${reasoning}.`,
  { tags: ['episodic', `cycle:${currentCycle}`, `action:${actionName}`], R: 0.5 }
);
```

C2. **Data cube ingestion** (FR-080):
```ts
await dataCube.ingest({
  cycle: currentCycle,
  source: actionName,
  payload: actionResult,
});
```

C3. **Identity reflection** (cadence: every N cycles, configurable; FR-013):
```ts
if (currentCycle % IDENTITY_REFLECT_EVERY === 0) {
  const newSnapshot = await identity.reflect(/* uses dialectic internally; routes via engine */);
  await memory.record(newSnapshot.text, { tags: ['identity_snapshot', `version:${newSnapshot.version}`] });
}
```

C4. **Goal proposals + acceptance** (FR-014):
```ts
const proposals = await goals.propose({ memory, drives });
for (const p of proposals) {
  const acceptanceVerdict = await goals.accept(p);
  await memory.record(p.text, { tags: ['goal_proposal', `status:${acceptanceVerdict}`] });
}
```

C5. **Watchdog audit** (FR-016):
```ts
const findings = await watchdog.validateAll({ recentCycles: 10, memory, dialectic });
for (const f of findings) {
  await memory.record(f.text, { tags: ['watchdog_finding', f.open ? 'open' : 'resolved'] });
}
```

C6. **Skills synthesis** (cadence: when watchdog flags repeated success):
```ts
const skill = await skills.synthesize({ trajectory });   // returns RPP-structured proposal
if (skill) {
  await memory.record(JSON.stringify(skill), { tags: ['skill_proposal'] });
}
```

C7. **Memory consolidation** (R9 — exactly once per V2 cycle, at end):
```ts
await memory.cycle();
```
*Source*: `runcor-memory/src/memory-system.ts` (`cycle()` runs full decay + promote + forget + plan-rewrite).

### D. Schedule next wake

D1. **Compute next wake** (FR-020):
```ts
const wake = temporal.computeNextWake({
  drives,
  pendingDeadlines: temporal.pressingDeadlines(currentCycle).length,
  overdueCommitments: temporal.overdueCommitments(currentCycle).length,
  unresolvedCoherenceProblems: coherence.openProblems().length,
  currentCycle,
});
// wake: { ms: number, reason: string }
```
*Source*: research.md §R7 — sibling extension.

D2. **Day-boundary check** (FR-021, FR-060):
```ts
const isBoundary = temporal.isDayBoundary({
  currentCycle,
  lastBoundaryCycle: lastDayBoundary,
  cyclesPerDay: 200,
  realHoursSinceLastBoundary: hoursSinceLastBoundary,
});
if (isBoundary) {
  await runDailySummary();   // a special cycle that calls dialectic with reflect-on-day.rpp
}
```
*Source*: research.md §R7.

## Failure paths

### `cycle_failed_call` (FR-018)

If `engine.trigger(...)` throws after FR-017's bounded retry inside `modelRouter.complete`:

```ts
try {
  result = await engine.trigger('primordial-cycle', { ... });
} catch (e) {
  if (e instanceof ModelCallFailed) {
    // FR-018: record failed cycle, NO memory/data/action side effects
    eventBus.emit('cycle_record', {
      cycle: currentCycle,
      status: 'cycle_failed_call',
      failureReason: e.message,
      modelCalls: e.attempts,
      totalTokens: e.tokensConsumed,
    });
    // Skip side-effects step C; jump to step D (computeNextWake)
  } else {
    throw e;   // unexpected — bubble up
  }
}
```

For `cycle_failed_call`: NO memory.record, NO dataCube.ingest, NO action invocation (FR-018). `temporal.computeNextWake()` runs normally.

### `completed_with_flag` (FR-019c–FR-019f, retry-then-flag)

This is NOT a failure path — it's a **completed cycle with a flag artifact**. The substrate's installer handles the 3-attempt retry internally and **never throws** on exhaustion. Instead:
- The substrate writes a `discernment_flag` MemoryNode via `memory.record(...)` (FR-019c).
- The substrate emits a `discernment_flagged` telemetry event (V2 dashboard subscribes — FR-019d1).
- The substrate returns the **best-of-three** response (severity comparator + tie-breaks on latest attempt).
- The cycle proceeds normally. Side effects commit (FR-019d): action invokes, `memory.record(...)` for episodic, `dataCube.ingest(...)`, `memory.cycle()` consolidation, etc.

V2's cycle handler does NOT need a special catch block for flag exhaustion. It does need to:
- Listen to the substrate's `discernment_flagged` event and tag the resulting `CycleRecord.status = 'completed_with_flag'` with `flag.flagNodeId / failedLawId` populated.
- Run a rolling-window count of flagged events (FR-019f) and emit a `flag_burst_warning` dashboard event when ≥ 5 flags occur in any 10-cycle window. The substrate is NOT responsible for this — V2 owns the burst-detection logic.

```ts
substrate.on('discernment_flagged', (ev) => {
  flaggedThisWindow.push({ cycle: ev.cycle, ts: Date.now() });
  trimWindow(flaggedThisWindow, 10);
  if (flaggedThisWindow.length >= 5) {
    eventBus.emit('flag_burst_warning', { recentFlags: flaggedThisWindow });
  }
  // CycleRecord update happens in the post-cycle handler below
});

// In the cycle's side-effects step, populate CycleRecord:
const lastFlag = consumeLastFlagEventForCycle(currentCycle);  // returned by the substrate event listener for this cycle
const record: CycleRecord = {
  cycle: currentCycle,
  agentRole: 'v2',
  status: lastFlag ? 'completed_with_flag' : 'completed',
  flag: lastFlag ? { flagNodeId: lastFlag.flagNodeId, failedLawId: lastFlag.failedLawId, attemptsCount: 3 } : undefined,
  // ... rest as usual
};
```

## Control process bindings

The control's cycle protocol is the **same boot wiring up through step 12**, except:

- Cognitive components in step 10 are constructed with `disabled: true` flag (or simply NOT constructed): no dialectic, no meta, no watchdog, no skills, no drives, no identity, no goals, no temporal scheduling (uses fixed cadence per FR-105), no coherence.
- `memory` is constructed but used in **read-only mode**: control may call `memory.query(...)` (which returns empty since nothing was written), MUST NOT call `memory.record(...)` or `memory.cycle()` (FR-101).
- Same for `dataCube` — read-only against an empty cube.
- Substrate is installed identically (FR-100). **Layer set is identical to V2's** (Principle VI: same rails). The control registers all 7 PromptLayers (`laws`, `reality`, `drives`, `goals`, `identity`, `capabilities`, `memory_recall`) — the contrast is in the data sources backing them, NOT in which layers fire:
  - `laws`: identical 10 Laws, non-empty.
  - `reality`: backed by control's empty data cube → renders empty.
  - `drives`: control DOES register the DrivesLayer; the layer's data source returns whatever value V2's DrivesLayer would render at the same boot moment with no harness inputs (typically all-zero baseline). The point is that the layer FIRES with identical shape on both rails — what differs is that on V2's side those values evolve under temporal/coherence/goals feedback, while on control's side nothing reads or updates them.
  - `goals`: empty (control has no goals component) → renders empty.
  - `identity`: empty (no identity component) → renders empty.
  - `capabilities`: identical to V2's adapter view (same MCP local module + same dynamic discovery surface).
  - `memory_recall`: empty (control's memory has no writes).
  Identical architecture; the difference is harness data presence, not harness shape. This is what makes Principle VI's "same rails" testable.
- Cycle: every 5 minutes (`setTimeout` with `FR-105` cadence — only place a fixed timer is allowed; explicitly carved out by FR-101).
- Calls `engine.trigger('naive-control-cycle', { ... })` — the flow handler does ONE `modelRouter.complete()` call with the layered prompt and produces an action invocation directly (no dialectic, no re-asks beyond what substrate's gate enforces).

## API addition tracking

Sibling extensions required before V2 v0.1 ships, all per build-methodology (CLAUDE.md §13):

| Sibling | New API | FR | Detail |
|---|---|---|---|
| runcor-temporal | `computeNextWake(input)` | FR-020 | Pure function, signature in research.md §R7 |
| runcor-temporal | `isDayBoundary(input)` | FR-021 | Pure function, signature in research.md §R7 |
| runcor-identity | constructor accepts `memory: MemorySystem` | FR-016 | When provided, routes writes through `memory.record({ tags: ['identity_snapshot', ...] })` |
| runcor-goals | constructor accepts `memory: MemorySystem` | FR-016 | Goals as Plan in memory; proposals as MemoryNodes |
| runcor-coherence | constructor accepts `memory: MemorySystem` | FR-016 | Tasks as Plan; problems as MemoryNodes |
| runcor-memory | (optional) `findByTag(tag)` | perf | Not required for v0.1; in-memory filtering acceptable |

Siblings to clone + audit + fill gaps (Phase-0; GitHub repos operator-confirmed to exist 2026-05-05):

| Sibling | Clone URL | API surface needed | FR |
|---|---|---|---|
| runcor-substrate | `git@github.com:runcor-ai/runcor-substrate.git` | research.md §R3 | FR-010, FR-012, FR-015, FR-019b–FR-019e |
| runcor-data | `git@github.com:runcor-ai/runcor-data.git` | research.md §R5 | FR-080, FR-081, FR-082 |
| runcor-integration | `git@github.com:runcor-ai/runcor-integration.git` | research.md §R6 | FR-090, FR-091, FR-092 |

Whatever is missing from each cloned repo (audit happens as the first task of `/speckit.tasks`'s Phase-0 sequence) is filled by a PR back to that sibling repo, NOT by V2-local reimplementation.

The exact PR sequence is captured in `tasks.md` (Phase 2 — owned by `/speckit.tasks`).
