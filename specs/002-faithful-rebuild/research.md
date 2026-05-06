# Research: V2 Faithful Rebuild — Phase 0

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**Plan**: [./plan.md](./plan.md) | **Spec**: [./spec.md](./spec.md)

This document resolves the technical-context unknowns identified in plan.md before Phase 1 begins. Each item follows the format: **Decision / Rationale / Alternatives considered**. Where ground-truth was available (existing sibling source), file:line refs are cited.

---

## R1 — Engine cycle model: flow-triggered, V2 owns the loop

**Decision**: V2 implements its own cycle loop. Per cycle: V2 builds context inputs, calls `engine.trigger("primordial-cycle", { idempotencyKey, input })`, awaits the `Execution` result, then ingests results into memory + data and computes next wake.

**Rationale**: The runcor engine at `runcor/src/engine.ts:648` exposes `async trigger(flowName, options): Promise<Execution>` — there is no `engine.cycle()` method. The engine is event-driven over flow executions, not a per-tick cycle driver. This means "the engine drives the cycle" is the wrong mental model; the correct model is "V2 drives cycles, the engine drives one model-call-or-flow-per-trigger." The substrate's installer wraps `modelRouter.complete` so any model call inside any flow is gated; V2 just needs to register the right flow once at boot and trigger it each cycle.

**Alternatives considered**:
- *Use a runcor scheduled flow with cron* (`runcor/FEATURES.md` 013): rejected — V2's wake cadence comes from `runcor-temporal.computeNextWake()` (drive-pressure-driven), not cron.
- *Patch the engine to add `cycle()`*: rejected — this is V2's concern, not the engine's; the engine is deliberately flow-shaped.

**File refs**: `runcor/src/engine.ts:648` (trigger signature); `runcor/FEATURES.md:13` (state machine).

---

## R2 — Flow registration pattern

**Decision**: V2 registers two flows with the engine at boot — `primordial-cycle` (used by the V2 agent process) and `naive-control-cycle` (used by the control process). Both flows make exactly one `modelRouter.complete()` call as their primary action; the substrate installer wraps the call. The dialectic / meta / watchdog / skills components are invoked by V2 *outside* the flow but each of *their* internal model calls also routes through the engine, so they too pass through the substrate gate.

**Rationale**: The substrate's gate must wrap every model call. The simplest way to guarantee this is to keep `modelRouter` as the single chokepoint and let any caller (flow handler, dialectic round, identity reflection, etc.) hit it — the patch holds. Flow registration is therefore minimal: register the flow names so `engine.trigger()` resolves them, but don't try to encode V2's whole cognitive loop as a flow graph. That would compete with the cognitive components for orchestration responsibility.

**Alternatives considered**:
- *Encode the entire V2 cycle as a multi-step engine flow* (each step = a model call): rejected — duplicates what `runcor-coherence`, `runcor-dialectic` already orchestrate; couples V2 to the engine's flow DSL; harder to test.
- *Skip flow registration; call modelRouter directly*: rejected — bypasses engine's cost tracking + telemetry events that the dashboard subscribes to.

**Open detail to resolve in implementation**: the exact `FlowDefinition` shape — Phase-1 contract `sibling-bindings.md` will pin it once `runcor`'s flow registration API is read directly.

---

## R3 — `runcor-substrate` API surface

**Decision**: **Clone** `git@github.com:runcor-ai/runcor-substrate.git` to `C:/runcor May 3 2026/runcor-substrate/` (operator-confirmed 2026-05-05 that the GitHub repo exists; content state on the remote is unknown until cloned). Audit the cloned source against the minimum API surface below; whatever is missing, V2's Phase-0 work fills in (PRs back to the sibling repo, NOT V2-local reimplementations). Whatever already exists, V2 consumes as-is.

The minimum API surface V2 binds to:

```ts
export interface PromptLayer {
  name: string;          // 'laws' | 'reality' | 'drives' | 'goals' | 'identity' | 'capabilities' | 'memory_recall'
  render(context: LayerContext): string | null;  // null = empty layer
}

export class Substrate {
  constructor(opts: {
    laws: LawSet;
    dataCubeReader: DataCubeReader;  // injected — reads from runcor-data
    layers: PromptLayer[];           // ordered: laws, reality, drives, goals, identity, capabilities, memory_recall
  });
  installer: SubstrateInstaller;     // monkey-patches engine.modelRouter.complete
  promptStack: PromptStack;          // assembles cycle prompt from layers
  discernmentGate: DiscernmentGate;  // POST-call evaluation against laws
}

export class SubstrateInstaller {
  install(engine: Runcor): void;     // patches modelRouter.complete; throws if already patched
  isInstalled(engine: Runcor): boolean;  // for V2's boot-time engagement check (FR-012)
  uninstall(engine: Runcor): void;       // for tests only; not exposed in production V2
}

export class PromptStack {
  assemble(context: LayerContext): string;  // calls each layer.render() in order, joins with separators
  layerNames(): string[];                   // for telemetry — the names that participated in this assembly
}

export class DiscernmentGate {
  evaluate(response: string, context: LayerContext): DiscernmentVerdict;
  // verdict: { kind: 'pass' | 're-ask' | 'discard' | 'flag'; reason?: string; lawId?: string }
}

export interface DataCubeReader {
  // implemented by runcor-data; substrate accepts it as injection
  reality(query: { goal?: string; drive?: string; recentCycles?: number }): RealitySlice;
}
```

**Rationale**: This API matches every FR that names the substrate (FR-010, FR-012, FR-015, FR-019b–FR-019e). Layers are pluggable so the cognitive components can register their own `PromptLayer` (drives, goals, identity, memory_recall) without the substrate hardcoding their data sources. The `DataCubeReader` is injected so substrate doesn't take a build-time dependency on `runcor-data`.

**Alternatives considered**:
- *Substrate owns the layer data sources directly*: rejected — couples substrate to every cognitive component; fails the build-methodology principle (each component stands alone).
- *Layers are functions, not objects*: rejected — losing the `name` field would break telemetry (FR-030 needs prompt-stack layer names).
- *Discernment-gate as middleware only (no installer)*: rejected — installer is what makes Principle V enforceable; an opt-in middleware can be bypassed.

**Phase-0 deliverable**: V2's `tasks.md` will list (a) `git clone` of the remote, (b) audit of cloned source against this API, (c) PRs back to `runcor-substrate` filling in any missing surface. The Laws content (constitution's 10 principles converted to LLM-evaluable predicates) is part of the substrate's own scope, not V2's — but V2's PR may need to ship them if the cloned repo doesn't already.

### R3 — Audit findings (2026-05-05, post-clone)

**Cloned state**: `runcor-substrate@0.1.0` exists at `C:/runcor May 3 2026/runcor-substrate/`. Contains real source (`src/{types,laws,reality,prompt-stack,discernment-gate,installer,index}.ts`), a `config/ecosystem.yaml`, an R++ spec `evaluate-action.rpp`, and 1 test file. NOT an empty stub.

**What's already there** (V2 consumes as-is):
- ✅ **10 Laws content** at `src/laws.ts:66-77` — DEFAULT_LAWS hardcoded with reality / translation / judgment / constraint / feedback / memory / compounding / cost_value / simplicity / uncertainty. Compiled to ~120-token prompt block.
- ✅ **DataCubeReader interface** at `src/types.ts:68-84` — matches V2's spec, accepts injection.
- ✅ **Reality slice rendering** in `src/reality.ts` — queries the injected DataCubeReader, renders text.
- ✅ **Installer monkey-patch** in `src/installer.ts:39-111` — wraps `engine.modelRouter.complete`, injects laws + reality into system prompt, runs discernment gate post-call.
- ✅ **Discernment gate** in `src/discernment-gate.ts` — 10 code-first checks + 2 LLM-second checks.

**Gap V2 must close** (PRs back to `runcor-substrate`):
- ❌ **`PromptLayer` interface** — no pluggable layer registry. Substrate hardcodes laws + reality in `wrapSystemPrompt()`. V2 needs pluggable layers (drives / goals / identity / capabilities / memory_recall) per `prompt-stack-layers.md`.
- ❌ **Class-based `Substrate` wrapper** — currently a `createEcosystem()` factory returning an `Ecosystem` interface; V2 spec wants a class with `installer`, `promptStack`, `discernmentGate` as named members.
- ❌ **`SubstrateInstaller.isInstalled(engine)`** — V2's boot guard (FR-012) calls this; not exposed today.
- ❌ **`SubstrateInstaller.uninstall(engine)`** — needed for tests.
- ❌ **3-attempt re-ask retry loop inside the patch with retry-then-flag exhaustion** (FR-019b, FR-019b1, FR-019c, FR-019d) — current installer runs gate ONCE, doesn't re-ask. **This is the most important gap.** Operator decision (2026-05-05) on exhaustion behavior: retry-then-flag, NOT fail-fast. Specifically:
  1. Up to 3 attempts; failing verdict from each prior attempt becomes feedback in the next prompt (FR-019b1).
  2. After 3rd failure, substrate writes a `discernment_flag` MemoryNode via `runcor-memory.record(...)` with tags `['discernment_flag', 'law:<failedLawId>', 'cycle:<N>']` (FR-019c).
  3. Substrate returns the **best-of-three** response (lowest verdict severity, ties → latest attempt) so the cycle proceeds with side effects committing (FR-019d).
  4. Selection comparator: `pass > re-ask > flag > discard` — lower severity wins. Substrate-internal logic, not exposed to V2 callers.
- ❌ **Verdict shape — Operator Decision 2 (additive, not rename)**: ADD `'flag'` as a new variant to the substrate's existing `Outcome` enum. Do NOT rename `'escalate'`, `'block'`, `'modify'`. Keeps current substrate consumers stable and lets V2 consume the new variant. The mapping at consumption is V2-side: V2's cycle handler sees `kind: 'pass' | 're-ask' | 'flag' | 'discard'`. **Mapping table (per FR-019d3, operator decision 2026-05-05):** `pass → pass` / `modify → re-ask` (consumes a retry slot — substrate is NOT permitted to edit agent output) / `block → re-ask` for attempts 1–2 then `flag` on attempt 3 / `escalate → flag` **immediately on first occurrence** (substrate signalling "stop trying"; terminates the retry loop without consuming further attempts). Retry-then-flag fires after 3 attempts of `modify`/`block`, or 1 attempt of `escalate`, without reaching `'pass'`.
- ❌ **No more `DiscernmentUnresolved` exception class needed** — under retry-then-flag the cycle does NOT raise on exhaustion; it returns a tagged response. V2's cycle handler reads telemetry events (`discernment_flagged`) instead of catching exceptions.
- ❌ **`LayerContext` type** — not defined; substrate uses `string` or `DiscernmentContext` instead.
- ❌ **`PromptStack.assemble(context)` + `layerNames()`** — substrate has standalone `wrapSystemPrompt()` / `wrapPrompt()` functions, not a class with these methods.
- ⚠️ **Test coverage low** — only 1 test file (`test-laws.ts`). Installer / promptStack / discernment integration tests are absent. PRs should add coverage.

**Effort estimate**: ~40–50% of the surface V2 binds to is missing. Foundation is solid; architectural glue + retry semantics need PRing back. ~2–3 days of focused work for someone familiar with the engine's model-router internals.

---

## R4 — Substrate installer monkey-patch contract

**Decision**: The installer patches `engine.modelRouter.complete` (the single entry on the model router class at `runcor/src/model/router.ts`). Patch site = method override on the live instance, not class-prototype patch (so multiple engine instances in the same process — V2 + control + tests — each get their own patched router). The patched method (updated for retry-then-flag per operator decision 2026-05-05):

```ts
const original = engine.modelRouter.complete.bind(engine.modelRouter);
engine.modelRouter.complete = async (request: ModelRequest) => {
  const layered = substrate.promptStack.assemble({ ...currentLayerContext, baseRequest: request });
  let layeredRequest = { ...request, prompt: layered };
  const attempts: Array<{ verdict, response, tokens }> = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await original(layeredRequest);
    const verdict = substrate.discernmentGate.evaluate(response.text, currentLayerContext);
    attempts.push({ verdict, response, tokens: response.tokensUsed });
    if (verdict.kind === 'pass') return response;
    // re-ask: append failing-verdict feedback for next attempt (FR-019b1)
    layeredRequest = appendVerdictFeedback(layeredRequest, verdict);
  }
  // All 3 attempts exhausted — retry-then-flag (FR-019c, FR-019d)
  await substrate.recordFlag({
    failedLaw: { id: attempts[2].verdict.lawId, reason: attempts[2].verdict.reason },
    finalResponse: attempts[2].response.text,
    cycle: currentLayerContext.cycle,
    attempts,
  });
  // Emit telemetry event for dashboard
  substrate.emit('discernment_flagged', { cycle: currentLayerContext.cycle, attempts, returned: bestOfThree(attempts) });
  // Return best-of-three response so cycle proceeds with side effects (FR-019d)
  return bestOfThree(attempts).response;
};

function bestOfThree(attempts) {
  const severity = { pass: 0, re_ask: 1, flag: 2, discard: 3 };
  return attempts.reduce((best, cur) =>
    severity[cur.verdict.kind] < severity[best.verdict.kind] ? cur :
    severity[cur.verdict.kind] === severity[best.verdict.kind] ? cur :  // tie → latest
    best
  );
}
```

V2's boot guard (FR-012) calls `installer.isInstalled(engine)` after `installer.install(engine)` and **also** runs a smoke check: a synthetic `modelRouter.complete` call with a known-discernment-failing prompt. The smoke test expects (a) the call to return a response (not throw — retry-then-flag means no exception), (b) a `discernment_flag` MemoryNode to have been written, (c) telemetry to show 3 attempts.

V2's boot guard (FR-012) calls `installer.isInstalled(engine)` after `installer.install(engine)` and **also** runs a smoke check: a synthetic `modelRouter.complete` call with a dummy prompt that should fail discernment (e.g., empty response) and verify the verdict comes through.

**Rationale**: Instance-level patching avoids cross-engine pollution and lets the control process boot a fresh engine with a fresh substrate without affecting V2's. The 3-attempt loop with feedback-driven re-ask is inside the patched method (where retry context naturally lives), so any caller — flow handler, dialectic, identity, anything — gets identical retry semantics. The retry-then-flag exhaustion path (operator decision 2026-05-05) means **no exception is thrown** on exhaustion — the substrate returns a usable response with the flag persisted via `runcor-memory`. This preserves Principle V (every call is gated 3×) AND forward progress (the agent doesn't grind to a halt on a single Law violation in a 1000-cycle autonomous run). Observability is the audit trail: every flagged cycle is visible on the dashboard transcript and the flag MemoryNode re-enters the agent's MemoryRecall when contextually relevant.

**Alternatives considered**:
- *Class-prototype patch*: rejected — V2 + control share class definitions but need separate retry/state contexts.
- *Wrap modelRouter externally (decorator)*: rejected — callers can still grab the unwrapped router from `engine.modelRouter`. Patch is the only way to make bypass impossible.
- *Re-ask logic in V2 instead of substrate*: rejected — every model caller (V2's cycle, dialectic's rounds, identity's reflection) would need to reimplement; centralising in the patch keeps it DRY and unbypassable.
- *Fail-fast on exhaustion (throw `DiscernmentUnresolved`)*: rejected by operator 2026-05-05 — halts a 1000-cycle autonomous experiment on a single bad output, which is catastrophic for the experiment's signal.
- *Pure escalate (return flagged response with no persisted artifact)*: rejected — fails the Principle III audit-trail requirement; observers couldn't trace WHY the agent did something flagged.

**Note on retry tokens**: tokens consumed across the 3 attempts MUST be summed and reported in the `Execution` result (FR-019a, FR-019e). Engine event `cost:request` already fires per call, so the sum is computable from telemetry without changing the engine.

**Note on the burst warning (FR-019f)**: V2 owns the burst-detection logic, NOT the substrate. The substrate emits one `discernment_flagged` telemetry event per flagged cycle; V2's dashboard subscribes to these and computes a rolling 10-cycle window. If ≥ 5 flags appear in any such window, V2 surfaces a `flag_burst_warning` banner. The substrate stays simple — it just gates and flags.

---

## R5 — `runcor-data` API surface

**Decision**: **Clone** `git@github.com:runcor-ai/runcor-data.git` to `C:/runcor May 3 2026/runcor-data/` (operator-confirmed exists; content state unknown until cloned). Audit + extend pattern same as R3 — V2 consumes what's there, PRs the gaps. The minimum API V2 binds to:

```ts
export interface Entity {
  id: string;                 // canonical identifier after normalization
  name: string;
  type: string;               // 'person' | 'organization' | 'document' | 'event' | ...
  attributes: Record<string, AttributeValue>;
  provenance: ProvenanceRecord[];
}

export interface AttributeValue {
  value: unknown;
  source: string;             // cycle id + action that asserted this
  cycle: number;
}

export interface Edge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relation: string;           // 'works_at' | 'attended' | 'authored' | ...
  attributes?: Record<string, AttributeValue>;
  provenance: ProvenanceRecord[];
}

export interface Conflict {
  id: string;
  entityId: string;
  attribute: string;
  values: Array<AttributeValue>;  // ≥2 contradictory values with provenance
  status: 'open' | 'resolved';
  resolutionRule?: 'most_recent' | 'majority' | 'manual' | null;
}

export interface DataCube {
  // Ingestion (FR-080) — 5-stage pipeline
  ingest(input: IngestInput): Promise<IngestResult>;
  // Reads (FR-081, FR-082)
  query(opts: { goal?: string; drive?: string; relevance?: 'high' | 'any' }): RealitySlice;
  getEntity(id: string): Entity | null;
  listConflicts(status?: 'open' | 'resolved'): Conflict[];
  // Mgmt
  getStats(): { entities: number; edges: number; openConflicts: number };
}

export interface IngestInput {
  cycle: number;
  source: string;             // action name that produced this output
  payload: string | object;   // the action result
}

export interface RealitySlice {
  entities: Entity[];
  relevantEdges: Edge[];
  openConflicts: Conflict[];
  rendered: string;           // pre-rendered text for the substrate's Reality layer
}
```

The 5-stage pipeline (FR-080) lives inside `ingest()`: identify → normalize → relate → conflict → persist. Each stage is a separate function with its own tests; `ingest()` is the public entry. Stages may use the engine's model router for entity-extraction LLM calls (and those calls naturally pass through the substrate gate, recursively — fine, expected).

**Rationale**: Entity/Edge/Conflict are the three Key Entities the spec promises (`spec.md#key-entities`). The `query()` returning a `RealitySlice` is exactly what substrate's Reality layer needs (FR-081). Provenance per-attribute (not just per-entity) is what makes conflicts diagnosable (FR-082).

**Alternatives considered**:
- *Triple-store / RDF*: rejected — overkill for the experiment scale, slow without a real graph DB, and the data cube is ours to define.
- *Single SQLite table per kind, no abstraction*: rejected — V2 reads via the API; the underlying storage can be SQLite tables or anything else.
- *Streaming ingestion (event-driven)*: rejected for v0.1 — synchronous per-cycle is simpler and matches the per-cycle write rhythm.

**Storage**: `better-sqlite3` at `<agent>-data.db`. Three tables (`entities`, `edges`, `conflicts`) plus a `provenance` join. Schemas enumerated in `data-model.md`.

### R5 — Audit findings (2026-05-05, post-clone)

**Cloned state**: `runcor-data@0.1.0` exists at `C:/runcor May 3 2026/runcor-data/`. ~1,247 LOC. Real implementation, not a stub. Has `src/{types,database,data-cube,data-agent,pipeline,router}.ts`, 5 stage modules under `src/stages/`, parsers, R++ specs, 1 test file (~10% coverage), depends on `runcor-memory` + `better-sqlite3@12.6.2`.

**What's already there** (V2 consumes as-is or with light renaming):
- ✅ **5-stage pipeline IS IMPLEMENTED** — `runPipeline()` at `src/pipeline.ts:20-82` orchestrates `identify → normalize → relate → conflict → persist` exactly as FR-080 requires. Each stage is its own file with R++ spec backing (`classify-entity.rpp`, `normalize-entity.rpp`, `resolve-entity.rpp`, `resolve-conflict.rpp`).
- ✅ **SQLite storage** — `data_nodes` + `data_edges` tables (`src/database.ts:16-52`), embeddings stored as BLOB, semantic search via `DataCube.query()`.
- ✅ **Conflict detection** — stage 4 (`src/stages/conflict.ts:18`) does code-first field comparison + LLM resolution. Returns `ConflictResult` per ingest.
- ✅ **Memory integration** — uses `runcor-memory` for pattern learning context.
- ✅ **Embeddings + semantic graph traversal** — `DataCube.query(naturalLanguage)` uses embeddings for retrieval.

**Gap V2 must close** (PRs back to `runcor-data`):
- ❌ **`Entity` shape mismatch** — currently `DataNode { id, entity_type, content, structured: Record<string,unknown>, embedding, confidence, source, version, created_at, updated_at }`. V2 needs `Entity { id, name, type, attributes: Record<string,AttributeValue>, provenance: ProvenanceRecord[], createdAtCycle, lastUpdatedCycle }`. The `name` field is missing; `attributes` is flat, not wrapped; cycle tracking is wallclock-only.
- ❌ **`AttributeValue` wrapper** — not defined. Currently attributes are `Record<string, unknown>`. V2 needs per-attribute provenance: `{ value, source, cycle }`. This is FR-082's foundation — without it, conflict provenance is per-entity-update only, not per-attribute.
- ❌ **`ProvenanceRecord` interface** — not defined anywhere.
- ❌ **Persisted `Conflict` entity** — conflicts are computed transiently in stage 4 but NOT stored as Conflict rows with `id` / `status` / `resolutionRule`. Dashboard `/data` endpoint can't list "open conflicts" because no such persisted entity exists. FR-082 + dashboard FR-032 require this.
- ❌ **`RealitySlice` with `rendered` text** — `DataCube.query()` returns `GraphResult { nodes, edges }`, no pre-rendered text for the substrate's Reality layer. Substrate currently renders this itself via `runcor-substrate/src/reality.ts`, but V2's contract expects the cube to do it (so substrate stays generic over data sources).
- ❌ **`query({ goal, drive })` structured signature** — current `query(naturalLanguage: string)` takes a string. V2's MemoryRecall layer + substrate's Reality layer both need structured filtering.
- ❌ **`DataCube.getStats()`** — not exposed. Counts exist internally (`getNodeCount` in `database.ts`) but no public method.
- ❌ **Cycle awareness** — schema has `created_at` / `updated_at` (wallclock) but no `created_at_cycle` / `last_updated_cycle`. V2 cycle tracking depends on this.
- ⚠️ **Naming differences** — `DataNode` vs `Entity`, `from_id`/`to_id` vs `fromEntityId`/`toEntityId`, `getById` vs `getEntity`, `getConflicts` vs `listConflicts`. Either rename in PR or adapter-layer. Recommend rename PR for cleanliness.
- ⚠️ **No pipeline plugin/configuration API** — stages are hardcoded in `runPipeline()`. V2 v0.1 doesn't need to customise stages, but a `pipeline.configure({...})` method would be nice.

**Effort estimate**: ~60% of the V2-shaped surface needs PRing — substantial but mechanical (rename + add fields + add methods). Pipeline architecture is sound; the gap is in the persistence schema and the structured query/RealitySlice surfaces.

---

## R6 — `runcor-integration` API surface

**Decision**: **Clone** `git@github.com:runcor-ai/runcor-integration.git` to `C:/runcor May 3 2026/runcor-integration/` (operator-confirmed exists; content state unknown until cloned). Audit + extend pattern same as R3. The minimum API V2 binds to:

```ts
export interface Integration {
  // Discovery (FR-090)
  discoverSchemas(opts: { reachable: ReachableSource[] }): Promise<DiscoveryReport>;

  // Synthesis (FR-090, FR-091)
  synthesizeTools(report: DiscoveryReport, policy: SafetyPolicy): McpToolDefinition[];

  // Registration with engine (FR-092)
  registerWithEngine(engine: Runcor, tools: McpToolDefinition[]): Promise<void>;

  // For V2's dashboard tool inventory
  listKnownTools(): McpToolDefinition[];
}

export interface ReachableSource {
  kind: 'sqlite' | 'http' | 'mcp_server';
  uri: string;
}

export interface DiscoveryReport {
  cycle: number;
  sources: Array<{ uri: string; schemas: SchemaDescriptor[] }>;
}

export interface SchemaDescriptor {
  name: string;
  fields: Array<{ name: string; type: string }>;
  // for SQLite tables: columns + foreign keys
}

export interface SafetyPolicy {
  forbid: Array<'ddl' | 'mass_delete' | 'unbounded_select' | string>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: object;        // JSON Schema
  // V2 wraps these into actual MCP tools that the engine adapter exposes
}
```

Discovery for v0.1 only handles the SQLite case (CLAUDE.md §4: "SQLite-only today"). HTTP and remote MCP discovery are deferred — v0.1 returns empty for those `kind` values.

**Rationale**: Schema → MCP tool synthesis is the FR-090 contract. The safety policy at synthesis time (not at invocation time) is FR-091. `registerWithEngine` is what closes the loop — once tools are synthesised, they appear in the engine's adapter view (which is the FR-092 single source of truth for the prompt's capability layer).

**Alternatives considered**:
- *Registration via `runcor.addAdapter()` for each synthesised tool*: this *is* the proposed approach — each synthesised tool becomes part of an MCP-server-shaped surface that the engine's adapter consumes. The local MCP module from FR-200 is one such surface; a synthesised SQLite-schema-driven adapter is another. Same intake.
- *Run discovery automatically every cycle*: rejected for v0.1 — discovery is invoked manually from V2's boot + on operator command. Continuous discovery is a Phase-2 enhancement.

### R6 — Audit findings (2026-05-05, post-clone)

**Cloned state**: `runcor-integration@0.1.0` exists at `C:/runcor May 3 2026/runcor-integration/`. Has 5 R++ specs (`classify-schema`, `build-query`, `detect-pattern`, `summarize-entity`, `explain-system`), real source for SQLite-only schema discovery + tool generation, 1 test file. Depends on `runcor-memory` + `better-sqlite3@12.6.2`. Peer deps: `runcor`, optionally `pg`/`mysql2`/`tedious`.

**What's already there** (V2 consumes / minor adaptation):
- ✅ **SQLite schema discovery** — `discoverSchema(connector, model, cycle, sampleLimit)` at `src/schema-discovery.ts:19`. Reads tables via `PRAGMA table_info` + `foreign_key_list`, samples rows, classifies tables/columns with R++ + LLM. Outputs `SchemaSnapshot` (table-level: name, probable_purpose, confidence, columns, FKs, sample data).
- ✅ **Tool synthesis exists** — `generateTools(schema, connector, db)` at `src/tool-generator.ts:7`. Generates 3 tools per table (get-by-id, search, recent) + 1 `describe_system` meta tool. Tools are read-only by design (SELECT-only) → naturally safe.
- ✅ **R++ spec integration** — 5 specs pre-written; LLM classification/translation already wired.
- ✅ **Memory integration** — pattern learner connects to `runcor-memory`.
- ✅ **3-cube architecture** mentioned in README — short-term memory, long-term memory, integration database working in concert.

**Gap V2 must close** (PRs back to `runcor-integration`):
- ❌ **Top-level `Integration` interface MISSING** — functionality is split across `IntegrationAgent` + standalone functions (`discoverSchema`, `generateTools`, `queryByIntent`). V2 needs a single facade per `contracts/sibling-bindings.md`.
- ❌ **`ReachableSource` / `DiscoveryReport` / `SchemaDescriptor` / `SafetyPolicy` / `McpToolDefinition` types ALL missing** — currently uses `ConnectorConfig`, `SchemaSnapshot`, `TableSchema`, `DynamicTool` instead. Different shape, different field names. V2 PR adds the V2 enum/type set; the existing types can stay alongside as internal richer types.
- ❌ **`discoverSchemas(opts: { reachable })` unified entrypoint MISSING** — current `discoverSchema()` takes a single connector + model. No multi-source dispatch on `kind: 'sqlite' | 'http' | 'mcp_server'`. V2's plan accepts SQLite-only for v0.1 with empty handlers for the other kinds — but the unified API shape must exist.
- ❌ **`synthesizeTools(report, policy)` MISSING** — `generateTools` does not accept a `SafetyPolicy`. It filters by table-confidence (≥ 0.4 hardcoded at line 15) but does not check `policy.forbid` for DDL/mass-delete/unbounded-select. Tools are safe today by being SELECT-only, but FR-091's explicit policy enforcement is not implemented.
- ❌ **`registerWithEngine(engine, tools)` COMPLETELY MISSING** — **THIS IS THE MOST IMPORTANT GAP**. Without it, FR-092's "single intake path" is broken. Tools are generated and stored in `IntegrationDatabase` but no code path calls `engine.addAdapter(...)` to expose them to the agent. V2's PR must add this — the implementation will likely wrap the synthesised `DynamicTool[]` (which have handlers) into an MCP-server-shaped adapter and call `engine.addAdapter()`.
- ❌ **`listKnownTools()` MISSING** — no public API to retrieve persisted tool inventory.
- ⚠️ **Test coverage minimal** — only `test-database.ts` (~100 LOC). Schema discovery + tool generation untested in unit tests (have separate `test:schema` / `test:connector` scripts requiring API keys).
- ⚠️ **HTTP / MCP server discovery completely absent** — V2's plan only needs SQLite for v0.1, so deferred. But the abstraction shape (`ReachableSource.kind`) must exist so future kinds plug in cleanly.

**Effort estimate**: ~60% effort to bring to V2 shape (~50–60h focused work). The mechanisms exist; the V2-facing API surface is incomplete. The `registerWithEngine` gap is the critical-path item — until V2 can register synthesised tools with the engine adapter, dynamic action growth (FR-090, FR-092) is non-functional.

---

## R7 — `runcor-temporal` extensions

**Decision**: Add two methods to `runcor-temporal` (to its `Temporal` class at `runcor-temporal/src/temporal.ts`):

```ts
// FR-020 — drive-pressure-driven next-wake computation
computeNextWake(input: {
  drives: { resource: number; curiosity: number; reactivity: number; coherence: number };
  pendingDeadlines: number;          // count of pressing deadlines at currentCycle
  overdueCommitments: number;        // count
  unresolvedCoherenceProblems: number; // from runcor-coherence
  currentCycle: number;
}): {
  ms: number;                        // milliseconds until next wake; bounded [30_000, 21_600_000] per FR-020a/b
  reason: string;                    // human-readable (e.g., "high curiosity + 1 pressing deadline")
}

// FR-021 — day-boundary detection
isDayBoundary(opts: {
  currentCycle: number;
  lastBoundaryCycle: number | null;  // null if no boundary has occurred yet
  cyclesPerDay: number;              // configurable, default 200 per FR-060
  realHoursSinceLastBoundary: number;
}): boolean;
```

These are deterministic functions — no LLM calls, no I/O. `computeNextWake` uses a simple weighted sum of pressures with the deadline/commitment/coherence counts adding step-functions. Exact formula tunable but starting point: `ms = clamp(BASE / (1 + sum_of_pressures_and_counts), 30_000, 21_600_000)` where `BASE` is the wake interval at zero pressure (≈ 30 minutes).

**Rationale**: Adding to an existing sibling beats reimplementing in V2 (CLAUDE.md §13 + spec FR-020). Both methods are pure — easily unit-testable inside `runcor-temporal` itself, no new external dependencies. Day-boundary's logic ("24 real hours OR 200 cycles, whichever first" per FR-060) is exactly the kind of cycle-vs-wallclock reasoning `runcor-temporal` already does in `Clock` (`runcor-temporal/src/clock.ts:14-52`).

**Alternatives considered**:
- *Implement in V2*: rejected — explicitly forbidden by FR-020 ("V2 does not reimplement").
- *Use ML / learned cadence*: rejected for v0.1 — deterministic formula is testable and traceable; learned cadence is a Phase-2 enhancement.

**Phase-0 deliverable**: PR to `runcor-temporal` adding both methods + tests; bumps to v0.2.0; V2 consumes v0.2.0+.

---

## R8 — Identity / goals / coherence: inject runcor-memory store

**Decision**: Extend `runcor-identity`, `runcor-goals`, `runcor-coherence` so each constructor accepts an optional `MemorySystem` reference. When provided, the component routes its writes through `memory.record(content, { tags, R })` with conventional tags:

| Component | Tag scheme | Plan-shape vs Node-shape |
|---|---|---|
| `runcor-identity` | `['identity_snapshot', 'version:<N>']` | `MemoryNode` (free-form content: the self-theory text), one per reflection version |
| `runcor-goals` | per goal: `['goal', 'kind:<purpose\|objective\|initiative>', 'goal_id:<...>']` | The goal stack as a whole becomes a `Plan` (PlanItems map naturally to P/O/I); individual goal *proposals* (rejected or accepted) become `MemoryNodes` tagged `['goal_proposal', 'status:<accepted\|rejected>']` |
| `runcor-coherence` | tasks: `['coherence_task', 'task_id:<...>']`; problems: `['coherence_problem', 'open\|resolved']` | Active task list is a `Plan`; resolved problems become `MemoryNodes` |

When no `memory` is provided (e.g., in standalone tests), components fall back to their existing default SQLite stores.

**Rationale**: This satisfies FR-016 ("MUST persist via runcor-memory's plan-rewrite pathway") without breaking the components' standalone usability. The tag scheme is grep-able from the dashboard's `/identity`, `/goals`, `/coherence` endpoints (which read `memory.getAll()` and filter). The Plan-shape choice for goals + coherence-tasks is justified by R-memory's verified data model: PlanItems have status / priority / completed_cycle (`runcor-memory/src/llm.ts:38-53`) — exactly the shape goals and tasks need. Identity self-theory is free text, so MemoryNode is correct (per the resolved Plan ≠ MemoryNode distinction in `clarifications`).

**Alternatives considered**:
- *V2-side bridge that copies sibling SQLite writes into memory after the fact*: rejected — dual-write, two sources of truth, exactly the pattern FR-016 forbids.
- *Force memory injection (no fallback)*: rejected — breaks the components' existing test suites and standalone usability; sibling-friendly code accepts injection, doesn't require it.
- *Drop identity/goals/coherence's local DBs entirely*: rejected as too invasive for v0.1; v0.2 of those siblings can deprecate them once memory injection proves out.

**Phase-0 deliverable**: 3 PRs (one per sibling) adding optional `memory: MemorySystem` constructor option; tests verifying both modes.

---

## R9 — `memory.cycle()` invocation cadence

**Decision**: V2's per-cycle protocol calls `memory.cycle()` exactly once at the end of each successful cycle (after action side effects, before computing next wake). The control process does NOT call `memory.cycle()` (it has no memory writes per FR-101).

**Rationale**: `MemorySystem.cycle()` runs the full consolidation pass: short-cube decay, long-cube decay, promotion, forgetting, plan rewrite (verified at `runcor-memory/src/memory-system.ts:38-454`). Running it once per V2 cycle keeps the cadence "1 V2 cycle = 1 memory cycle" — straightforward to reason about in the dashboard, and matches the M-decay formula's cycle-as-time-unit (FR-071). V2 must NOT invoke `memory.cycle()` mid-cycle as that would corrupt the M values for nodes the cycle is currently working with.

**Alternatives considered**:
- *Component-controlled internal cadence*: deferred — `runcor-memory` could in principle run consolidation on a timer, but coupling to V2's cycle counter is simpler and gives V2 deterministic control.
- *Multiple `memory.cycle()` calls per cycle*: rejected — risks decay-during-recall artifacts.

---

## R10 — Data cube growth bounding

**Decision**: For v0.1, no automatic retirement of data-cube entries. The cube grows monotonically; conflicts accumulate. If size becomes a problem during the experimental run (>10MB SQLite file or >10⁶ rows), Phase-2 adds an M-decay analogue or LRU-style retirement. This is a documented v0.1 limitation, not a bug.

**Rationale**: The experimental run is bounded: 1000 cycles × ~20 entities/cycle × 2 attributes-each ≈ 40k attribute writes — comfortable for SQLite. Premature retirement risks deleting facts the agent will need; better to overshoot for v0.1 and tune in v0.2 if needed.

**Alternatives considered**:
- *Match memory's M-decay*: rejected for v0.1 — data-cube facts have different relevance dynamics than memory nodes; copying the formula without analysis is cargo-culting.
- *Manual operator-triggered cleanup*: rejected — operator should not touch agent-state.

---

## R11 — Local in-process MCP server module

**Decision**: V2's `src/mcp-local/` declares its 9 tools as an `AdapterToolDefinition[]` and registers them via runcor v0.3.0's **in-process MCP transport** (added 2026-05-06 in `runcor-ai/runcor` PR #2 for V2-002 FR-200). V2's boot calls `engine.addAdapter({ name: 'v2-local-actions', transport: 'in-process', tools: [...] })`. The engine's adapter framework dispatches tool calls directly to the inline handler functions — no subprocess, no port binding, no `@modelcontextprotocol/sdk` SDK required.

**Why in-process transport** (operator decision 2026-05-06, after verifying `runcor/src/adapter/adapter-manager.ts:74-87`): runcor's adapter framework only supported `stdio` and `sse` transports until v0.3.0. The TS type union (`TransportType = 'stdio' | 'sse'`) and `validateConfig` enforced the constraint at compile + runtime. Spawn-as-subprocess (stdio) and localhost-port-binding (sse) both spread multi-process failure modes into V2's deployment shape — V2's spec doesn't account for "what happens if the local-MCP subprocess crashes mid-cycle?" or "what if the port binding fails?". Adding `transport: 'in-process'` as a third TransportType variant in runcor was the smallest delta from the V2 spec as written; preserves FR-200 verbatim, eliminates process-lifecycle complexity, and gives runcor consumers in general a tool-surface option that doesn't require external processes. Implementation: `runcor.createInProcessClientFactory()` + `AdapterToolDefinition { name, description, inputSchema, handler }`.

V2 composes `createInProcessClientFactory()` with its other transport factories in the `AdapterFactory` it injects to the engine's `AdapterManager`. The engine remains transport-agnostic; the consumer (V2) decides which transports to support.

**Alternatives considered**:
- *stdio MCP server as a child process*: rejected — process management overhead, harder local debugging.
- *Custom non-MCP plugin interface*: rejected — engine's adapter is MCP-shaped; custom would require an extra adapter; FR-200b ground truth says no static tool registry exists.
- *Roll our own minimal MCP*: rejected — SDK is small and well-tested.

**Source for verification**: `runcor/FEATURES.md:101-130` (009 MCP Adapter — "reference configs (Gmail/Slack/Calendar)" indicate the engine consumes external MCP servers; the local module just speaks the same protocol).

---

## R12 — Bearer-token middleware

**Decision**: Use plain Node `http.IncomingMessage.headers.authorization` checking. No Express, no Fastify, no Hapi. A small middleware function `requireBearerToken(handler)` wraps each `/operator/*` route handler. `OPERATOR_AUTH_TOKEN` is loaded from env at boot; if missing, the dashboard process refuses to start.

**Rationale**: V2's dashboard already uses raw Node HTTP (inherited from 001). Adding Express is a heavy dependency for a 4-route auth concern. The middleware is ~15 lines; the test surface is tiny.

**Alternatives considered**:
- *Express + `express-bearer-token`*: rejected — net-new dependency, not justified by scope.
- *JWT with rotation*: rejected — single-operator use case, shared secret is appropriate.
- *OAuth*: rejected per spec Q5 (Option D rejected — overkill for single operator).

---

## R13 — Engine telemetry → dashboard SSE

**Decision**: Subscribe to engine `EventEmitter` events at boot:
- `cost:request` → cost panel + transcript token costs
- `adapter:tool_call` → transcript "agent invoked tool X with args Y"
- `execution:state_change` + `execution:complete` → transcript flow lifecycle
- `provider:health_change` → ops banner on dashboard
- `cost:budget_exceeded` → halt cycle loop + post terminal record

Each subscription forwards a structured event to a single `EventBus` in V2 that the dashboard's SSE route consumes. This keeps the engine ↔ dashboard coupling unidirectional (engine emits, V2 forwards, dashboard subscribes) and means the dashboard sees identical telemetry whether the call originated from V2's primordial-cycle, the control's naive-cycle, or any sub-component (dialectic round, identity reflection, watchdog audit).

**Rationale**: Engine event names are stable (verified at `runcor/src/engine.ts:82-147`). Single-bus aggregation avoids each route file subscribing to engine events directly (which would spread coupling).

**Alternatives considered**:
- *Direct SSE subscription on engine events*: rejected — couples HTTP routes to engine internals.
- *Polling via `engine.getStats()`*: rejected — high latency, fights the existing SSE pattern.

---

## R14 — `runcor.modelRouter` lacks intra-provider transient-error retry (verified 2026-05-05)

**Decision**: Add a **Phase-0f** sibling PR to `runcor` adding bounded transient-error retry inside `ModelRouter.complete()` per FR-017.

**Verified state of `runcor/src/model/router.ts`** (read 2026-05-05): The router implements multi-provider fallback (try the next provider on error) with per-provider circuit breakers. It does NOT retry the same provider with exponential backoff on transient errors. The for-loop at `runcor/src/model/router.ts:182-205` calls `provider.complete()` once per provider, records circuit-breaker failure on any thrown error (including 429 / 5xx / network), and immediately falls through to the next provider. With OpenRouter as the only configured provider (V2's setup per 001 inheritance), a single 429 fails the entire call to `AllProvidersFailedError`.

**Gap vs FR-017**: FR-017 specifies "up to 3 attempts with exponential backoff" for transient classes (network, 5xx, 429, timeout) on the SAME provider. Provider fallback ≠ intra-provider retry. With one effective provider, the gap is total — zero retry coverage on transient hiccups.

**Patch**: Inside the for-loop body around `runcor/src/model/router.ts:196`, on a caught error that classifies as transient, retry the SAME provider up to 3 times with exponential backoff (e.g., 200ms × 2^n) before recording the breaker failure and falling through. Non-transient errors (4xx other than 429, auth failures, malformed-request) skip retry.

**Error classification** (proposed):

```ts
function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as any).statusCode ?? (err as any).status;
  if (typeof status === 'number') {
    if (status === 429) return true;            // rate limit
    if (status >= 500 && status < 600) return true;  // server error
    return false;                                // 4xx (other than 429), 3xx, etc.
  }
  const code = (err as any).code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ECONNREFUSED') return true;
  return false;
}
```

**Alternatives considered**:
- *Keep FR-017 satisfied by provider fallback alone*: rejected — single-provider deployments (V2 with OpenRouter only) get zero retry coverage; defeats the FR's intent.
- *Implement retry in V2 around `engine.trigger(...)`*: rejected — duplicates the engine's role; bypasses telemetry; every caller (V2's cycle, dialectic, identity, etc.) would need to reimplement. Centralising in the engine keeps it DRY.
- *Implement retry in substrate's installer wrapper*: rejected — substrate's retry loop is for *discernment* failures (Law violations), a different concern. Mixing transient-network retry with discernment retry conflates two error classes; substrate fires its 3 attempts only on gradeable responses.

**Phase-0f deliverable**: PR to `runcor` adds `isTransient` + retry loop + tests; bumps engine to v0.2.0; V2 consumes that version. ~½ day of focused work.

---

## Summary of Phase-0 outcomes

- **0 NEEDS-CLARIFICATION markers remain.** All technical-context unknowns resolved.
- **3 sibling repos cloned + audited 2026-05-05**: `runcor-substrate`, `runcor-data`, `runcor-integration` — none are empty stubs; each has real working code with material gaps vs the V2 contract. Detailed audit findings appended to R3, R5, R6 sections above. Headline gaps:
  - `runcor-substrate` — ~40-50% of V2-shape missing. **Critical gap**: 3-attempt discernment re-ask retry loop is NOT implemented inside the installer patch (FR-019b enforcement). Verdict shape ('escalate' vs 'flag') needs alignment. Pluggable PromptLayer system + class-based wrappers + `isInstalled()` all missing.
  - `runcor-data` — ~60% of V2-shape missing. 5-stage pipeline IS already implemented. Gaps are persistence-shape: per-attribute provenance via `AttributeValue {value, source, cycle}`, persisted `Conflict` entities (currently transient), cycle-aware tracking, `RealitySlice` with `rendered` text, structured `query({goal, drive})` signature, naming alignment (Entity vs DataNode).
  - `runcor-integration` — ~60% of V2-shape missing. SQLite schema discovery + read-only tool synthesis already exist. **Critical gap**: `registerWithEngine(engine, tools)` is COMPLETELY MISSING — no code path connects synthesised tools to the engine adapter, so FR-090/FR-092 dynamic action growth is non-functional today. Top-level `Integration` facade + V2 type set + safety-policy enforcement also missing.
- **Sequence implication**: PRs to `runcor-substrate` (especially the retry loop) are the highest priority — Principle V enforcement depends on it. PRs to `runcor-integration` (especially `registerWithEngine`) are critical-path for the dynamic-action FRs. PRs to `runcor-data` are mechanical (rename + add fields + add methods); large surface but low risk.
- **4 sibling-side extensions** before V2 consumes: `runcor-temporal` (R7), `runcor-identity`/`runcor-goals`/`runcor-coherence` (R8).
- **0 constitutional violations** in the proposed approach. The Phase-1 design phase begins with green gates.
- **Verified ground truth saved to memory**: 3 memory entries already exist (engine-zero-builtin-tools, memory-query API, memory-primitives Plan-vs-Node). This research reaffirms them; no new contradictions.
