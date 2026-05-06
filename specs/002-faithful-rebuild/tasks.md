---
description: "Task list for V2 Faithful Rebuild — feature 002-faithful-rebuild"
---

# Tasks: V2 Faithful Rebuild — Primordial Agent on the Full runcor Harness

**Input**: Design documents from `/specs/002-faithful-rebuild/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dashboard-api.md, contracts/mcp-local-tools.md, contracts/prompt-stack-layers.md, contracts/sibling-bindings.md, quickstart.md

**Tests**: INCLUDED. The spec's FRs include explicit test invariants (e.g., `contracts/prompt-stack-layers.md` "Test invariants" section, FR-076b "MemoryRecall layer never fabricates a query", FR-019d "side effects commit on best-of-three"). Tests are how user stories' independent-test criteria become enforceable.

**Organization**: Tasks are grouped by phase. **Phase 0 is Sibling PRs (BLOCKING)** — operator-acknowledged ~5-day prerequisite per build-methodology (CLAUDE.md §13). Phases 1+ are V2 source.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files / different repos / no dependencies)
- **[Story]**: Maps the task to a spec user story (US1..US9). Phase-0/Setup/Foundational/Polish tasks have NO story label.
- All file paths absolute or repo-relative as specified.

## Path Conventions

- **V2 source**: `C:/runcor May 3 2026/autonomous-company-v2/src/` and `tests/`
- **Sibling repos** (PRs go here, NOT V2): `C:/runcor May 3 2026/<sibling-name>/`
- All sibling PRs ship from their own repo first, then V2 consumes via `package.json` `file:../<name>`

---

## Phase 0: Sibling PRs (BLOCKING — must complete before V2 src/ begins)

**Purpose**: Close the gaps surfaced by the 2026-05-05 audit (research.md §R3, §R5, §R6) plus the sibling extensions identified in §R7, §R8. Per build-methodology: each capability ships from its own sibling repo first.

**⚠️ CRITICAL**: V2 cannot boot until all 14 component repos are at the required version. Phase 1 (Setup) cannot start until this phase is complete.

### Phase 0a — runcor-substrate (HIGHEST priority — Principle V depends on it)

- [X] T001 Implement 3-attempt feedback-driven re-ask loop in `runcor-substrate/src/installer.ts` (FR-019b, FR-019b1) — replace single-evaluation flow with `for (let attempt=1; attempt≤3; attempt++)`; on failing verdict, append failed-Law id + reason to next prompt as feedback; pseudocode in research.md §R4. **Done 2026-05-05 on `runcor-substrate` branch `feat/v2-002-retry-then-flag` (commit ea8bb7e). All 27 existing tests pass.**
- [X] T002 Implement retry-then-flag exhaustion path in `runcor-substrate/src/installer.ts` (FR-019c, FR-019d) — after 3rd failure: write `discernment_flag` MemoryNode via `runcor-memory.record(...)` with tags `['discernment_flag', 'law:<id>', 'cycle:<N>']` and content per data-model.md §DiscernmentFlag; emit `discernment_flagged` telemetry event; return best-of-three response (severity comparator: pass<re-ask<flag<discard, ties→latest). **Done 2026-05-05 (commit ea8bb7e). Best-of-three substrate-internal severity: pass(0) < modify(1) < escalate(2) < block(3); ties → latest attempt. Flag content includes attempts audit trail (capped at 2KB per response for size).**
- [X] T003 [P] Add `'flag'` as additive variant to substrate's existing `Outcome` enum in `runcor-substrate/src/types.ts` (Operator Decision 2 — additive, not rename). Preserve `'pass'|'modify'|'block'|'escalate'`. Document the new variant in README.md. **Done 2026-05-05 (commit ea8bb7e). README update deferred to T010 (PR-open task).**
- [X] T004 [P] Add `PromptLayer` interface + pluggable layer registry in `runcor-substrate/src/prompt-stack.ts` — replace hardcoded `wrapSystemPrompt()` with composable `assemble(context: LayerContext)` calling `layer.render(ctx)` in registered order. **Done 2026-05-05 (commit 1290a2c). `PromptStack` class with `assemble()`, `layerNames()`, `nonEmptyLayerNames()`. Default `LawsLayer` (always non-empty) + `RealityLayer` (null when cube empty). `LAYER_SEPARATOR = '\n\n---\n\n'`. Legacy `wrapSystemPrompt` kept for backwards compat.**
- [X] T005 [P] Add `LayerContext` type in `runcor-substrate/src/types.ts` matching data-model.md §PromptLayer. **Done 2026-05-05 (commit 1290a2c). Plus opaque-shape interfaces (DrivePressures, GoalLike, MemoryNodeLike, ToolLike, BaseRequest) so substrate stays decoupled from runcor-goals / runcor-memory / runcor type imports beyond runcor-memory's existing dep.**
- [X] T006 [P] Add class-based `Substrate` + `SubstrateInstaller` wrappers in `runcor-substrate/src/index.ts` exposing `installer.install(engine)`, `installer.isInstalled(engine)`, `installer.uninstall(engine)` per research.md §R3. **Done 2026-05-05 (commit db811f1). New `src/substrate.ts` + extracted `src/retry-then-flag.ts` shared between legacy and class-based installers. Install state tracked via WeakMap<router, originalFn> + Symbol.for('runcor-substrate/installed') brand on patched method. `isInstalled(engine)` returns true iff THIS installer instance installed (different installer instances distinguishable). Per-call flow: reads `request.__substrateLayerContext` if attached by consumer (V2 flow handler), else builds fallback context (cognitive layers render null). Backwards-compatible for callers that don't yet thread LayerContext.**
- [X] T007 [P] Add `runcor-substrate/tests/installer.spec.ts` — verifies `isInstalled` lifecycle, monkey-patch engagement, retry loop firing 3 times, retry-then-flag exhaustion writes flag node + returns best-of-three response. **Done 2026-05-05 (commit da983d6) as `tests/test-installer.ts` matching substrate's existing `test-*.ts` naming. 44 tests.**
- [X] T008 [P] Add `runcor-substrate/tests/prompt-stack.spec.ts` — verifies layer order + empty-layer contracts (cycle-0 layers per FR-076b). **Done 2026-05-05 (commit da983d6) as `tests/test-prompt-stack.ts`. 29 tests including FR-076b cycle-0 canonical layer behavior (laws+drives+capabilities only).**
- [X] T009 [P] Add `runcor-substrate/tests/discernment-gate.spec.ts` — exercise pass / re-ask / flag / discard verdicts and severity comparator. **Done 2026-05-05 (commit da983d6) as `tests/test-discernment-gate.ts`. 26 tests including ATTEMPT_SEVERITY ordering and bestOfAttempts comparator (modify beats escalate beats block; ties → latest).**
- [X] T010 Bump `runcor-substrate` version to 0.2.0, update README.md with retry-then-flag behavior + Operator Decision 2 mapping table, push commits, open PR; merge after review. **Done 2026-05-05 (commit 5b1bd75). Branch `feat/v2-002-retry-then-flag` pushed to origin. PR #1 opened: https://github.com/runcor-ai/runcor-substrate/pull/1. 5 commits, 126/126 tests pass, build clean.**

### Phase 0b — runcor-integration (CRITICAL — single-intake path depends on it)

- [X] T011 [P] Implement `registerWithEngine` in `runcor-integration/src/integration.ts` (FR-092). **Done 2026-05-06. Uses runcor v0.3.0 in-process transport (`engine.addAdapter({ transport: 'in-process', tools: [...] })`). Empty tools list short-circuits.** PR: runcor-ai/runcor-integration#1.
- [X] T012 [P] Add V2 type set in `runcor-integration/src/types.ts`. **Done 2026-05-06. Added `ReachableSource`, `SchemaDescriptor`, `SchemaDescriptorField`, `DiscoveryReport`, `SafetyPolicy`, `McpToolDefinition`, `Integration`, `EngineLike` + `DEFAULT_SAFETY_POLICY`.**
- [X] T013 [P] Unified `discoverSchemas(opts)` in `runcor-integration/src/integration.ts`. **Done 2026-05-06. SQLite via existing pipeline; HTTP/mcp_server return empty schemas.**
- [X] T014 [P] `synthesizeTools(report, policy)` with safety filter in `runcor-integration/src/integration.ts`. **Done 2026-05-06. Defense-in-depth name-pattern filter: `^(create|drop|alter|truncate|rename)[-_]` blocks DDL; `^delete[-_]` blocks mass-deletes. Default policy = ['ddl','mass_delete','unbounded_select']. Current generateTools produces only read-only tools so filter is a no-op today.**
- [X] T015 [P] `listKnownTools()` on Integration facade. **Done 2026-05-06. Returns defensive copy of synthesised inventory.**
- [X] T016 [P] `runcor-integration/tests/test-register-with-engine.ts` (13 tests). **Done 2026-05-06.**
- [X] T017 [P] `runcor-integration/tests/test-safety-policy.ts` (13 tests). **Done 2026-05-06.**
- [X] T018 Bump version to 0.2.0, push, open + merge PR. **Done 2026-05-06. PR #1 merged. 48/48 tests passing.**

### Phase 0c — runcor-data (mechanical schema + shape work)

- [X] T019 [P] V2-shape types in `runcor-data/src/types.ts`. **Done 2026-05-06. Added Entity / AttributeValue / ProvenanceRecord / Edge / Conflict / RealitySlice / IngestInput / IngestResult / DataCubeStats / RealityQueryInput.** PR: runcor-ai/runcor-data#1.
- [X] T020 [P] SQLite schema migration in `runcor-data/src/database.ts`. **Done 2026-05-06. Added created_at_cycle + last_updated_cycle + name columns to data_nodes (idempotent ALTER ADD COLUMN); new `provenance` and `conflicts` tables.**
- [X] T021 [P] Persisted `Conflict` entity. **Done 2026-05-06. Conflicts written via DataCube.ingest pipeline; resolution mapping: escalate→open, new_wins/existing_wins→resolved with most_recent rule.**
- [X] T022 [P] `RealitySlice` + `DataCube.queryReality({ goal, drive, relevance? })`. **Done 2026-05-06. Pre-rendered text included; legacy query(naturalLanguage) preserved.**
- [X] T023 [P] `DataCube.getStats` + `listConflicts(status?)`. **Done 2026-05-06.**
- [X] T024 [P] Aliased `DataCube.getEntity` returning V2 Entity; conversion helpers `dataNodeToEntity` / `dataEdgeToV2Edge` (private). **Done 2026-05-06.**
- [X] T025 [P] `runcor-data/tests/test-cycle-aware.ts` (18 tests). **Done 2026-05-06.**
- [X] T026 [P] `runcor-data/tests/test-conflict-persistence.ts` (22 tests). **Done 2026-05-06.**
- [X] T027 [P] `runcor-data/tests/test-reality-slice.ts` (39 tests). **Done 2026-05-06.**
- [X] T028 Bump to 0.2.0, push, open + merge PR. **Done 2026-05-06. PR #1 merged. 110/110 tests passing.**

### Phase 0d — runcor-temporal (sibling extension)

- [X] T029 [P] `computeNextWake(input)` pure function in `runcor-temporal/src/temporal.ts`. **Done 2026-05-06. Formula: ms = clamp(BASE / (1 + sum_of_pressures_and_counts), MIN, MAX). BASE=30min, MIN=30s, MAX=6h.** PR: runcor-ai/runcor-temporal#1.
- [X] T030 [P] `isDayBoundary(input)` pure function. **Done 2026-05-06. Either-or threshold (cycles ≥ 200 OR realHours ≥ 24, whichever first); both configurable.**
- [X] T031 [P] `runcor-temporal/tests/computeNextWake.test.ts` (9 tests). **Done 2026-05-06.**
- [X] T032 [P] `runcor-temporal/tests/isDayBoundary.test.ts` (13 tests). **Done 2026-05-06.**
- [X] T033 Bump to 0.2.0, push, open + merge PR. **Done 2026-05-06. PR #1 merged. 35/35 tests passing.**

### Phase 0e — Memory injection extensions (R8) — runcor-identity / runcor-goals / runcor-coherence

- [X] T034 [P] runcor-identity memory injection. **Done 2026-05-06. Optional `memory: MemoryRecorder` field on IdentityOptions; dual-writes (local SQLite still authoritative for queries; memory is publish channel). Best-effort: memory.record errors don't break local flow.** PR: runcor-ai/runcor-identity#1.
- [X] T035 [P] runcor-goals memory injection. **Done 2026-05-06. Dual-writes accept (status:accepted), reinforce (goal_reinforced), retire (goal_retired) events.** PR: runcor-ai/runcor-goals#1.
- [X] T036 [P] runcor-coherence memory injection. **Done 2026-05-06. Dual-writes submit (coherence_task), detect (coherence_problem), initiate (coherence_flow + corrective task via unified submit() path).** PR: runcor-ai/runcor-coherence#1.
- [X] T037 [P] `runcor-identity/tests/unit/memory-injection.test.ts` (8 tests). **Done 2026-05-06.**
- [X] T038 [P] `runcor-goals/tests/unit/memory-injection.test.ts` (7 tests). **Done 2026-05-06.**
- [X] T039 [P] `runcor-coherence/tests/unit/memory-injection.test.ts` (7 tests). **Done 2026-05-06.**
- [X] T040 Bump 3 siblings to 0.2.0, push, open + merge 3 PRs. **Done 2026-05-06. All three PRs merged.**

### Phase 0f — runcor (engine) intra-provider retry (FR-017 / addresses C1)

- [X] T161 [P] `isTransient(err)` helper in `runcor/src/model/router.ts`. **Done 2026-05-06. Classifies 429, 5xx, network codes (ETIMEDOUT/ECONNRESET/ENOTFOUND/ECONNREFUSED) as transient.** PR: runcor-ai/runcor#1.
- [X] T162 Bounded retry inside `ModelRouter.complete()`. **Done 2026-05-06. New private `completeWithRetry` helper — up to 3 SAME-provider attempts with 200ms × 2^n backoff before circuit-breaker failure + provider fallback.**
- [X] T163 [P] `runcor/tests/unit/model/router-retry.test.ts` (13 tests). **Done 2026-05-06.**
- [X] T164 Bump `runcor` to v0.2.0 + FEATURES.md note. **Done 2026-05-06. PR #1 merged. 41/41 existing tests still pass.**

**Checkpoint**: All 14 sibling components are at the V2-required version (including `runcor` v0.2.0 with intra-provider retry). V2 src/ work can begin.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: V2 project initialization and basic structure.

- [ ] T041 Update `package.json` listing all 14 siblings as `file:../<name>` deps: runcor, runcor-substrate, runcor-memory, runcor-data, runcor-integration, runcor-dialectic, runcor-meta, runcor-watchdog, runcor-skills, runcor-drives, runcor-identity, runcor-goals, runcor-temporal, runcor-coherence + `@modelcontextprotocol/sdk`, `imapflow`, `nodemailer`, `dotenv`, `better-sqlite3`. Verify all 14 resolve via `npm ls`. (FR-011)
- [ ] T042 [P] Confirm `tsconfig.json` is strict-mode ESM (matches 001 baseline)
- [ ] T043 [P] Confirm `vitest.config.ts` is unchanged from 001 baseline
- [ ] T044 [P] Create project skeleton dirs: `src/{boot,engine,mcp-local,agent,control,dashboard,rater,hypothesis,shared}` and `tests/{unit,integration,contract}`
- [ ] T045 [P] Create `src/shared/lints/no-direct-provider.ts` — ESLint or grep-based lint guard preventing imports of `openrouter`/`@anthropic-ai/sdk`/`openai`/raw HTTPS to model-provider URLs outside the engine package (FR-010 enforcement). Wire into `npm run typecheck`.
- [ ] T165 [P] Create `src/shared/lints/no-laws-literal.ts` — grep-based lint guard preventing literal `LAWS = [`, `const LAWS`, `"TASK:"` footers, or any cycle-prompt template strings in V2 source (FR-015 enforcement; addresses C4). Wire into `npm run typecheck` alongside T045's no-direct-provider lint. Both lints fail CI on hits.
- [ ] T046 [P] Create `src/shared/env.ts` loading + validating required env vars (OPENROUTER_API_KEY, OPERATOR_AUTH_TOKEN, FIRECRAWL_API_KEY, RUNNER_EMAIL_*, GIT_PUSH_*, etc.). Boot fails with named-key error if any required key missing.
- [ ] T047 [P] Port 001 dashboard frontend shell to `src/dashboard/frontend/{index.html,app.js,style.css}` (per spec out-of-scope §"Keep")
- [ ] T048 [P] Port 001 rater module to `src/rater/{index.ts,rubric.ts}` unchanged (FR-061, frozen rubric)
- [ ] T049 [P] Port 001 hypothesis-matcher module to `src/hypothesis/` unchanged (FR-041)
- [ ] T050 [P] Create `src/main.ts` — process role dispatcher; reads first CLI arg (`agent` | `control` | `dashboard`) and routes to appropriate boot
- [ ] T051 Update root `CLAUDE.md` if any V2-specific reminders not yet captured (this file is already comprehensive)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Boot wiring + per-cycle infrastructure that ALL user stories depend on.

**⚠️ CRITICAL**: No user-story phase can begin until this phase is complete.

### 14-component boot infrastructure

- [ ] T052 Create `src/boot/components.ts` — canonical 14-name registry (FR-011); exports the array `CANONICAL_COMPONENTS = ['runcor', 'runcor-substrate', ..., 'runcor-coherence']`
- [ ] T053 Create `src/boot/installer-check.ts` — calls `substrate.installer.isInstalled(engine)` AND runs the smoke check from research.md §R4 (synthetic discernment-failing prompt → expects 3 attempts + flag node + best-of-three return). Throws on either failure (FR-012).
- [ ] T054 Create `src/boot/startup-record.ts` — builds `StartupRecord` per data-model.md (14 components with pinned versions + health + control-config hash)
- [ ] T055 Create `src/boot/boot.ts` — orchestrates the 16-step boot sequence from `contracts/sibling-bindings.md` "Boot order"; fails closed on any component-init failure (FR-011); names the missing component(s) in the error message; publishes StartupRecord to dashboard

### Engine + flow registration

- [ ] T056 Create `src/engine/factory.ts` — single source for V2 + control engine instantiation with provider registrations (OpenRouter); used by both processes (G6 enforcement)
- [ ] T057 [P] Create `src/engine/flows/primordial-cycle.ts` — registers the `primordial-cycle` flow with the engine; flow handler makes one `modelRouter.complete()` call which the substrate installer wraps
- [ ] T058 [P] Create `src/engine/flows/naive-control-cycle.ts` — registers the `naive-control-cycle` flow; single Player call, no dialectic (FR-101)
- [ ] T059 Create `src/engine/telemetry.ts` — subscribes to engine `EventEmitter` events (`cost:request`, `adapter:tool_call`, `execution:state_change`, `provider:health_change`, `cost:budget_exceeded`) per research.md §R13; forwards to V2 `EventBus`

### Local in-process MCP server

- [ ] T060 [P] Create `src/mcp-local/server.ts` — `@modelcontextprotocol/sdk` in-process server hosting V2's tool surface; exports `createLocalMcpServer({ tools })` returning the server + an `asAdapterConfig()` for `engine.addAdapter(...)` (FR-200, research.md §R11)
- [ ] T061 [P] Create `src/mcp-local/tools/firecrawl-scrape.ts` per `contracts/mcp-local-tools.md` schema
- [ ] T062 [P] Create `src/mcp-local/tools/inbox-read.ts` (imapflow)
- [ ] T063 [P] Create `src/mcp-local/tools/email-send.ts` (nodemailer)
- [ ] T064 [P] Create `src/mcp-local/tools/git-push.ts`
- [ ] T065 [P] Create `src/mcp-local/tools/fs-read.ts` (path-safety guards)
- [ ] T066 [P] Create `src/mcp-local/tools/fs-write.ts` (path-safety guards)
- [ ] T067 [P] Create `src/mcp-local/tools/fetch-chunk.ts` (reads from runcor-data provenance cache)
- [ ] T068 [P] Create `src/mcp-local/tools/web-search.ts` (provider-agnostic; selected at boot)
- [ ] T069 [P] Create `src/mcp-local/tools/publish-post.ts` — calls `memory.record(content, { tags: ['daily_summary', 'day:<N>'], R: 0.7 })` per FR-062
- [ ] T070 [P] Create `src/mcp-local/tools/terminate.ts` — records termination MemoryNode + triggers result.md generation (FR-050, FR-052, FR-110)
- [ ] T071 Create `src/mcp-local/index.ts` — registers all 10 tools with the server + provides factory used by `boot.ts`

### Cognitive component wiring

- [ ] T072 [P] Wire memory in `boot.ts`: instantiate `MemorySystem` with `db: <agent|control>-memory.db` + config (FR-070)
- [ ] T073 [P] Wire data cube in `boot.ts`: instantiate `DataCube` with `db: <agent|control>-data.db` (FR-080)
- [ ] T074 [P] Wire integration in `boot.ts`: instantiate Integration; run `discoverSchemas({ reachable })` once at boot; `synthesizeTools(report, policy)` filtering destructive ops; `registerWithEngine(engine, tools)` (FR-090, FR-091, FR-092)
- [ ] T075 [P] Wire substrate in `boot.ts`: instantiate per `contracts/prompt-stack-layers.md` "Layer registration" snippet (7 layers in deterministic order); `installer.install(engine)`; assert `isInstalled` + smoke check
- [ ] T076 [P] Wire identity / goals / coherence with memory injection per R8 PRs (T034–T036)
- [ ] T077 [P] Wire temporal: `createTemporal()` + new `computeNextWake` / `isDayBoundary` from T029/T030
- [ ] T078 [P] Wire stateless components (drives, watchdog, skills, meta, dialectic) — no construction beyond import; called per cycle as functions

### Dashboard scaffolding

- [ ] T079 Create `src/dashboard/server.ts` — Node `http` server + SSE; ports 001's HTTP scaffolding + transcript-pagination cursor
- [ ] T080 [P] Create `src/dashboard/auth.ts` — bearer-token middleware (`requireBearerToken(handler)`) checking `Authorization: Bearer <OPERATOR_AUTH_TOKEN>` (FR-132); 401 on missing/invalid
- [ ] T081 [P] Create agent-egress filter for `/scores` route (FR-134) — rejects requests whose source IP / network identity matches the agent process even with valid token
- [ ] T082 Create `src/dashboard/event-bus.ts` — single in-process bus; receives engine telemetry forwards (T059), substrate events (`prompt_assembled`, `discernment_flagged`), V2 cycle records; SSE route consumes from it

### Control config + invariants

- [ ] T083 Create `control-config.json` (frozen) per data-model.md §ControlConfig; SHA-256 hash computed at boot (FR-102) and published in StartupRecord (FR-011a)
- [ ] T084 Create `src/control/config.ts` — loads + validates control-config.json; mid-run mutation detection forces both V2 + control restart (FR-103)

**Checkpoint**: 14-component boot is functional, dashboard reachable, all telemetry wired, control-config hashed. User-story implementation begins.

---

## Phase 3: User Story 1 — Boot fails fast (Priority: P1) 🎯 MVP

**Goal**: V2 startup fails closed with a clear error naming missing/non-engaged components. There is no degraded mode.

**Independent Test**: Remove any one of the 14 components from `package.json` (or break `substrate.installer.isInstalled()`); run `npm start agent`. Process MUST exit non-zero, error message names the missing/broken component, and NO LLM call is made before the failure.

### Tests for User Story 1

- [ ] T085 [P] [US1] `tests/unit/boot-guard.spec.ts` — table-driven: for each of the 14 component names, simulate component absent → expect boot to fail with that component named in the error
- [ ] T086 [P] [US1] `tests/unit/installer-engagement.spec.ts` — verifies `installer.isInstalled(engine)` returns false before `install()`, true after; smoke-test scenarios for non-engagement
- [ ] T087 [P] [US1] `tests/integration/startup-record.spec.ts` — verifies dashboard StartupRecord shows all 14 components with pinned versions + health-check pass
- [ ] T166 [P] [US1] `tests/integration/cycle-0-no-commercial-words.spec.ts` — captures cycle-0 prompt; asserts no occurrence of `sell|earn|customer|revenue|profit|MRR` (case-insensitive) anywhere in the assembled prompt (FR-003 enforcement; addresses C3)
- [ ] T167 [P] [US1] `tests/integration/memory-corruption-fail-closed.spec.ts` — corrupt `agent-memory.db` SQLite header before boot, attempt boot, expect non-zero exit + named error mentioning `runcor-memory` (spec Edge Cases §"Memory store corruption"; addresses C6)
- [ ] T168 [P] [US1] `tests/integration/installer-partial-patch-fail-closed.spec.ts` — simulate substrate installer engaging on the model-router instance method but not on a re-entry path (e.g., a class-level overwrite that masks the patch); boot guard MUST detect the partial state and fail closed (spec Edge Cases §"Substrate installer fails partway"; addresses C7)

### Implementation for User Story 1

- [ ] T088 [US1] Verify `boot.ts` (T055) handles each of the 14 components' construction in a try/catch that names the failing component; ensure NO model call fires before all components init successfully
- [ ] T089 [US1] Wire `installer-check.ts` (T053) into boot to fail if installer-not-engaged

**Checkpoint**: Boot integrity is enforced; the experiment cannot run with a partial harness.

---

## Phase 4: User Story 2 — Every LLM call goes through the substrate gate (Priority: P1)

**Goal**: No code path issues a model call that bypasses the engine + substrate. Every call is gated 3× with feedback-driven re-ask; on exhaustion the substrate writes a flag MemoryNode and returns best-of-three.

**Independent Test**: Static-search V2 source for direct provider imports — must return 0 matches outside the engine. Run integration test: a synthetic Law-violating prompt → 3 attempts → `discernment_flag` MemoryNode persisted → cycle completes with `status: 'completed_with_flag'`.

### Tests for User Story 2

- [ ] T090 [P] [US2] `tests/contract/no-direct-provider.spec.ts` — runs the lint guard from T045; fails if any V2 source file imports a model-provider SDK directly (FR-010 enforcement)
- [ ] T091 [P] [US2] `tests/integration/substrate-gate.spec.ts` — every component's model call (dialectic round, identity reflection, goal proposal, daily summary) must show prompt-stack layers + discernment-gate verdict in telemetry
- [ ] T092 [P] [US2] `tests/integration/retry-then-flag.spec.ts` — synthetic Law-violating prompt → expect 3 attempts (each carrying prior verdict as feedback) → `discernment_flag` MemoryNode written via `memory.record` → best-of-three response returned → cycle status = `completed_with_flag` → side effects DID commit (FR-019b–FR-019f). **Also assert: `costSpent` after the test ≥ sum of tokens consumed across all 3 attempts (FR-019a — retry tokens count to $200 budget).**
- [ ] T093 [P] [US2] `tests/integration/flag-burst-warning.spec.ts` — simulate 5 flagged cycles in 10-cycle window → `flag_burst_warning` event fires (FR-019f)
- [ ] T169 [P] [US2] `tests/integration/modify-verdict-mapping.spec.ts` — substrate emits `modify` outcome → V2 adapter treats as `re-ask` (consumes a retry slot, NOT a pass-through, NOT a discard); substrate emits `escalate` outcome → V2 rolls straight into flag on first occurrence without consuming the remaining attempts (per FR-019d3; addresses C2)
- [ ] T170 [P] [US2] `tests/integration/flag-recall-reentry.spec.ts` — after retry-then-flag fires (T092), set the next cycle's goal/drive context to semantically align with the failed-Law topic → assert the `discernment_flag` MemoryNode appears in the cycle's `MemoryRecall` layer (FR-019d2 — flag re-entry feedback loop)

### Implementation for User Story 2

- [ ] T094 [US2] Wire substrate's `discernment_flagged` event to V2's EventBus; consumer enriches `CycleRecord.flag` (per data-model.md §CycleRecord)
- [ ] T095 [US2] Implement burst-window detector in `src/dashboard/event-bus.ts` (FR-019f) — rolling 10-cycle window of flagged events; emits `flag_burst_warning` at threshold ≥ 5
- [ ] T096 [US2] Update `src/dashboard/routes/transcript.ts` to surface `substrate_intervention` (per re-ask), `discernment_flagged`, and `flag_burst_warning` events distinctly per `contracts/dashboard-api.md`

**Checkpoint**: Every cycle's path through the gate is observable; flagged cycles are visible and persisted.

---

## Phase 5: User Story 3 — Cycle context comes from memory + data, not a slice (Priority: P1)

**Goal**: After many cycles, the next-cycle prompt contains memory-recall results + data-cube Reality slice, NOT a literal `actions[]` array. The agent accumulates.

**Independent Test**: Run V2 for ≥ 50 cycles. Capture cycle-50 prompt. Verify it contains: a `memory_recall` layer with retrieval scores, a `reality` layer rendered from data-cube entities/edges, NO `actions[]` field. Verify content from cycle 5 reaches cycle 50 only via memory consolidation, not a sliding window.

### Tests for User Story 3

- [ ] T097 [P] [US3] `tests/unit/context-builder.spec.ts` — verifies the FR-076 query template is exactly `"Goal: <top goal text>. Drive: <dominant drive label>. Last plan: <last plan précis>."` byte-for-byte; verifies cycle-0 contract (empty MemoryRecall when goals + plan empty per FR-076b)
- [ ] T098 [P] [US3] `tests/unit/side-effects-atomicity.spec.ts` — verifies on `cycle_failed_call` (FR-018) NO memory.record / NO dataCube.ingest / NO action invocation; verifies on `completed_with_flag` (FR-019d) side effects DO commit
- [ ] T099 [P] [US3] `tests/integration/memory-decay.spec.ts` — 50-cycle run; node accessed at cycle 5 has expected M after 45 cycles of decay; nodes below 0.05 retired from default recall (FR-073)
- [ ] T171 [P] [US3] `tests/integration/summary-decay-no-exemption.spec.ts` — a `daily_summary`-tagged MemoryNode with no reinforcement decays on the same schedule as a generic episodic node; verifies NO decay-exemption / NO `is_summary` flag bypass / NO pinning (FR-062b)
- [ ] T100 [P] [US3] `tests/integration/data-cube-conflict.spec.ts` — same entity, different attribute values from 2 different cycles → conflict persisted with provenance → surfaces in cycle's RealitySlice (FR-082)
- [ ] T101 [P] [US3] `tests/integration/no-actions-slice.spec.ts` — at cycle 50, prompt contains NO field literally named `actions` carrying raw rows from prior 5 cycles (FR-075)
- [ ] T102 [P] [US3] `tests/integration/memory-cycle-cadence.spec.ts` — verifies `memory.cycle()` invoked exactly once per V2 cycle, at cycle end (research.md §R9)

### Implementation for User Story 3

- [ ] T103 [US3] Create `src/agent/context-builder.ts` — assembles `LayerContext` per `contracts/sibling-bindings.md` step A: drives.computeDrives + goals.top + memory.getPlan + memory.query (with FR-076 template) + identity-from-memory + dataCube.query + engine.listAdapterTools
- [ ] T104 [US3] Create `src/agent/side-effects.ts` — atomic post-cycle pipeline (steps C1–C7 from sibling-bindings.md): episodic memory.record → dataCube.ingest → identity.reflect (cadence) → goals.propose+accept (cadence) → watchdog.validateAll → skills.synthesize (cadence) → memory.cycle (R9)
- [ ] T105 [US3] Create `src/agent/cycle.ts` — orchestrates per-cycle protocol: build context (T103) → engine.trigger('primordial-cycle', ...) → handle outcomes → side-effects (T104) → temporal.computeNextWake → repeat. Catches `ModelCallFailed` for `cycle_failed_call` (FR-018); reads `discernment_flagged` events for `completed_with_flag` (FR-019d)
- [ ] T106 [US3] Create `src/agent/index.ts` — boot agent role (calls boot/boot.ts in 'agent' mode) → starts cycle loop → terminates on any of: 1000 cycles, $200 spend, terminate() called (FR-110)
- [ ] T107 [US3] Wire `runDailySummary()` flow in `src/agent/cycle.ts`: when `temporal.isDayBoundary(...)` returns true, run a special cycle calling dialectic with `reflect-on-day.rpp` then invoking `publish_post` (FR-060–FR-063)

**Checkpoint**: V2's cycle is faithful: context is harness-derived, side effects are atomic, daily summary fires from temporal.

---

## Phase 6: User Story 4 — Naive control on the same rails (Priority: P1)

**Goal**: Control runs as a separate process on the same engine + substrate; cognitive harness disabled (single Player call). Both share model router, Laws, Reality-slice mechanism, action surface, budget enforcement, rater.

**Independent Test**: Inventory both processes' infrastructure. Both must hit the same engine factory, same substrate.installer, same MCP local module, same OpenRouter provider. Per-cycle telemetry must show identical engine/substrate signature on every call.

### Tests for User Story 4

- [ ] T108 [P] [US4] `tests/integration/control-parity.spec.ts` — both V2 and control processes' model calls show same engine/substrate signature in telemetry
- [ ] T109 [P] [US4] `tests/integration/control-config-freeze.spec.ts` — modifying `control-config.json` mid-run forces both V2 + control to restart from cycle 0 (FR-103)
- [ ] T110 [P] [US4] `tests/integration/control-isolated-stores.spec.ts` — V2 writes to `agent-memory.db` / `agent-data.db`; control reads from `control-memory.db` / `control-data.db`; stores are disjoint by default (FR-106)

### Implementation for User Story 4

- [ ] T111 [US4] Create `src/control/cycle.ts` — single Player call per cycle via `engine.trigger('naive-control-cycle', ...)`; no dialectic, no meta, no watchdog, no skills, no drives, no identity, no goals, no temporal scheduling, no coherence (FR-101)
- [ ] T112 [US4] Create `src/control/index.ts` — boot control role (calls boot/boot.ts in 'control' mode with cognitive components disabled per FR-101); fixed-cadence wake every 5 minutes (FR-105); reads memory + data in read-only mode (no record / no cycle / no ingest)
- [ ] T113 [US4] Update `src/main.ts` (T050) to dispatch `control` role to `src/control/index.ts`

**Checkpoint**: V2 and control run side-by-side on identical infrastructure. The contrast is observable.

---

## Phase 7: User Story 5 — Cadence + day-boundary from temporal (Priority: P2)

**Goal**: V2's wake cadence is computed by `runcor-temporal.computeNextWake`. Day boundaries detected by `runcor-temporal.isDayBoundary`. No fixed timers, no hand-rolled day boundaries.

**Independent Test**: Lint check — `src/agent/` contains zero `setTimeout` / `setInterval` against hardcoded durations (control's 5-min interval is a deliberate carve-out, lives in `src/control/` only). Integration test — rising drive pressure shortens wake interval monotonically.

### Tests for User Story 5

- [ ] T114 [P] [US5] `tests/integration/cadence-pressure.spec.ts` — rising drive pressures → next-wake interval shortens monotonically within [30s, 6h] band (FR-020a/b)
- [ ] T115 [P] [US5] `tests/integration/day-boundary-detection.spec.ts` — boundary fires at 200 cycles, fires at 24 real hours, whichever first (FR-060)
- [ ] T116 [P] [US5] `tests/contract/no-fixed-timers.spec.ts` — grep `src/agent/` for `setTimeout|setInterval` against literal numbers — must be 0 hits

### Implementation for User Story 5

(Mostly handled by Foundational T077 + T105's loop using temporal. Story 5 phase is verification + lint enforcement.)

- [ ] T117 [US5] Add the no-fixed-timers lint rule to `src/shared/lints/no-fixed-timers.ts`; wire into `npm run typecheck` (matches the existing 001 + T045 / T165 pattern; pre-commit not used in this repo).

**Checkpoint**: Cadence is harness-driven; the rhythm of life emerges from internal state.

---

## Phase 8: User Story 6 — Cognitive components persist via memory (Priority: P2)

**Goal**: Identity / goals / skills / watchdog state persists via `runcor-memory`'s plan/node pathway. V2's storage contains zero orphan tables for these.

**Independent Test**: Inspect SQLite files in V2's working dir — only `agent-memory.db`, `agent-data.db`, `agent-temporal.db`, `rater.db`, `operator.db` exist. NO `agent-identity.db`, NO `agent-goals.db`, NO `agent-coherence.db` (per data-model.md §"Storage layout summary" deprecation).

### Tests for User Story 6

- [ ] T118 [P] [US6] `tests/integration/no-orphan-tables.spec.ts` — after 50-cycle run, `ls *.db` only shows the 5 expected DBs (FR-016)
- [ ] T119 [P] [US6] `tests/integration/identity-via-memory.spec.ts` — identity reflection produces a MemoryNode tagged `['identity_snapshot', 'version:N']` queryable via `memory.getAll()` (R8)
- [ ] T120 [P] [US6] `tests/integration/goals-via-memory.spec.ts` — goal stack is a Plan in memory with PlanItems carrying `category: 'goal:*'`; proposals tagged `['goal_proposal', 'status:*']`

### Implementation for User Story 6

(Handled by Phase-0e R8 PRs (T034–T036) + Foundational T076 wiring. Story 6 phase is integration test.)

- [ ] T121 [US6] Create `src/dashboard/routes/identity.ts` — reads latest MemoryNode tagged `['identity_snapshot']` per `contracts/sibling-bindings.md` step A5; sorts by `created_cycle desc`
- [ ] T122 [US6] Create `src/dashboard/routes/goals.ts` — reads `memory.getPlan()` filtered to `category: 'goal:*'` PlanItems
- [ ] T123 [US6] Create `src/dashboard/routes/watchdog.ts` — reads MemoryNodes tagged `['watchdog_finding', 'open']`
- [ ] T124 [US6] Create `src/dashboard/routes/coherence.ts` — Plan filtered to `category: 'coherence_task'` + open coherence_problems

**Checkpoint**: All cognitive state is queryable through memory; the dashboard's read paths reflect this.

---

## Phase 9: User Story 7 — Action surface grows from observed schemas (Priority: P2)

**Goal**: Adding a new SQLite database to the agent's reach produces new MCP tools after `runcor-integration` discovery; capability layer reflects them on next cycle.

**Independent Test**: Add `test-fixture.db` with a new schema → re-run `integration.discoverSchemas(...)` → integration `synthesizeTools` + `registerWithEngine` → next cycle's prompt's `capabilities` layer includes the new tools.

### Tests for User Story 7

- [ ] T125 [P] [US7] `tests/integration/dynamic-tools.spec.ts` — add a fixture SQLite DB → run discovery → expect `engine.listAdapterTools()` to include synthesised tools and the cycle prompt's capability layer to render them
- [ ] T126 [P] [US7] `tests/integration/safety-policy.spec.ts` — verify destructive operations (DDL, mass-delete) are filtered at synthesis time even if the schema would allow them (FR-091)
- [ ] T127 [P] [US7] `tests/integration/dynamic-tool-routing.spec.ts` — invoking a synthesised tool still goes through engine + substrate (FR-092 single-intake)

### Implementation for User Story 7

(Handled by Phase-0b runcor-integration PRs (T011–T015) + Foundational T074. Story 7 phase is integration verification + dashboard inventory route.)

- [ ] T128 [US7] Add `src/dashboard/routes/tools.ts` (or extend `/startup-record`) showing dynamic + local tools currently registered; refreshes when integration runs

**Checkpoint**: Action surface is plastic, growing from observed structure.

---

## Phase 10: User Story 8 — Dashboard /memory + /data + 001 surfaces (Priority: P2)

**Goal**: Dashboard exposes read-only views of `runcor-memory` and `runcor-data`; all 001 surfaces (transcript, identity, goals, drives, watchdog, coherence, blog, scores, hypothesis, rater) work; `/scores` blocks agent egress.

**Independent Test**: Hit each documented endpoint per `contracts/dashboard-api.md`; verify response shape + auth behavior; `/scores` MUST 401 without bearer and MUST 403 from agent egress even with valid bearer.

### Tests for User Story 8

- [ ] T129 [P] [US8] `tests/contract/memory-endpoint.spec.ts` — `GET /memory` returns `{ stats, nodes, edges, plan, cursor, hasMore }` per dashboard-api.md
- [ ] T130 [P] [US8] `tests/contract/data-endpoint.spec.ts` — `GET /data` returns `{ stats, entities, openConflicts, cursor, hasMore }` per dashboard-api.md
- [ ] T131 [P] [US8] `tests/contract/operator-auth.spec.ts` — `POST /operator/pause` returns 401 without bearer, 200 with valid bearer
- [ ] T132 [P] [US8] `tests/contract/scores-egress.spec.ts` — `GET /scores` from a request matching agent-egress identity returns 403 even with valid bearer (FR-134)
- [ ] T133 [P] [US8] `tests/contract/blog-tag-filter.spec.ts` — `GET /blog` returns MemoryNodes filtered by `tags.includes('daily_summary')`, sorted by `created_cycle desc` (FR-062a)

### Implementation for User Story 8

- [ ] T134 [P] [US8] Create `src/dashboard/routes/memory.ts` per dashboard-api.md — pagination via `?after=<cursor>&limit=<n>`; default limit 50; returns stats + nodes (truncated content) + edges + current Plan
- [ ] T135 [P] [US8] Create `src/dashboard/routes/memory-node.ts` — `GET /memory/node/:id` returning full content + edges + access history
- [ ] T136 [P] [US8] Create `src/dashboard/routes/data.ts` per dashboard-api.md — entities + openConflicts + stats; pagination
- [ ] T137 [P] [US8] Create `src/dashboard/routes/data-entity.ts` — `GET /data/entity/:id` full entity + edges + provenance
- [ ] T138 [P] [US8] Create `src/dashboard/routes/blog.ts` — reads via `memory.getAll()` filtered by tag (FR-062a); rendered Markdown for `/blog/`; alias `/summaries`
- [ ] T139 [P] [US8] Create `src/dashboard/routes/drives.ts` — recomputes 4 pressures per request via `runcor-drives.computeDrives({ memory, temporal })`
- [ ] T140 [P] [US8] Create `src/dashboard/routes/scores.ts` — bearer-gated + agent-egress filter; reads from `rater.db`
- [ ] T141 [P] [US8] Create `src/dashboard/operator-store.ts` — initialises `operator.db` SQLite schema with `operator_actions` table (id, ts, kind, payload, authenticatedAs) per data-model.md §OperatorAction (FR-130) — V2-local store distinct from any agent-state DB
- [ ] T172 [P] [US8] Create `src/dashboard/routes/operator.ts` — `pause`, `resume`, `note` (bearer-gated POST per FR-132); `log` (public GET per FR-133); writes append to `operator.db` from T141
- [ ] T142 [P] [US8] Create `src/dashboard/routes/control.ts` — mirror routes prefixed `/control/*`
- [ ] T143 [P] [US8] Create `src/dashboard/routes/healthz.ts` per dashboard-api.md — liveness probe returning `{ ok, agentRole, cycles, budgetSpentUsd }`
- [ ] T173 [P] [US8] Create `src/dashboard/routes/startup-record.ts` per dashboard-api.md — returns the boot record (14 components + pinned versions + health + control-config hash + substrate-installer-engaged) from T054
- [ ] T144 [P] [US8] Wire 001-ported `/hypothesis` and `/rater` route shells into the new dashboard server (FR-041)
- [ ] T145 [P] [US8] Add `/memory` and `/data` panels to the frontend (`src/dashboard/frontend/app.js`) — they were the explicit dashboard adds for 002

**Checkpoint**: Dashboard surfaces parity with 001 plus the two new windows into accumulated state.

---

## Phase 11: User Story 9 — Result publication (Priority: P3)

**Goal**: When V2 ends (1000 cycles, $200 spend, or terminate()), `result.md` auto-generates with V2 + control summaries / scores / spend / termination reason; published to public repo regardless of outcome.

**Independent Test**: Force end condition. `result.md` MUST be generated, MUST include all listed sections, MUST be linked from dashboard.

### Tests for User Story 9

- [ ] T146 [P] [US9] `tests/integration/result-md-generation.spec.ts` — terminate at cycle 100 → result.md generated with V2's identity, V2's final goal stack, daily summaries (all), score trajectory, total spend, termination reason; same for control
- [ ] T147 [P] [US9] `tests/integration/result-published-on-null.spec.ts` — terminate after 0 daily summaries → result.md still generated and published (Principle VII)
- [ ] T174 [P] [US9] `tests/integration/post-terminate-readonly.spec.ts` — after terminate(), assert dashboard read endpoints (`/transcript`, `/memory`, `/data`, `/blog`, `/identity`, `/goals`, `/result`) continue to serve their last state (FR-052); mutation endpoints (`/operator/pause`, `/operator/resume`, `/operator/note`) MUST return HTTP 503 with `code: 'terminated'` per dashboard-api.md error table
- [ ] T175 [P] [US9] `tests/integration/terminate-during-summary.spec.ts` — agent calls `terminate()` mid-flight while a daily-summary cycle is running; the in-flight summary completes (best-effort) and is published before exit (spec Edge Cases §"Terminate during daily-summary generation"; addresses C16)

### Implementation for User Story 9

- [ ] T148 [US9] Create `src/agent/result-md.ts` — generator triggered on any end condition (FR-110); pulls from runcor-memory (summaries by tag, identity by tag, goals as Plan), rater.db, telemetry
- [ ] T149 [US9] Create `src/agent/result-publisher.ts` — git push to results repo; link from dashboard `/result` route
- [ ] T150 [US9] Create `src/dashboard/routes/result.ts` — serves the generated result.md (or 404 until first run ends)

**Checkpoint**: Negative results have an output. Honesty closed-loop.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening before deploy.

- [ ] T151 [P] Run full test suite (`npm test`); confirm count ≥ 90 (the 001 regression floor) plus all new tests; all green
- [ ] T152 [P] Run `npm run typecheck` — zero errors
- [ ] T153 [P] Run `npm run preflight` — env vars + sibling-resolution sanity
- [ ] T154 [P] Walk through `quickstart.md` step-by-step on a fresh clone to validate the whole path; fix any docs gap
- [ ] T155 [P] Validate `/scores` blocking from agent egress against a real Railway deploy (with the agent process's egress IP set)
- [ ] T176 [P] Implement continuous harness-engagement monitor in `src/agent/cycle.ts` — interval from `HARNESS_MONITOR_INTERVAL_CYCLES` env var (default 100); each fire re-runs `substrate.installer.isInstalled(engine)` + 14-component liveness ping; emits `harness_engaged` / `harness_disengaged` telemetry events; halts cycle loop on disengagement pending operator review (FR-019g; SC-005; addresses C5). Cross-cutting concern, not story-scoped.
- [ ] T177 [P] `tests/integration/continuous-harness-monitor.spec.ts` — simulate substrate uninstalling at cycle 150; expect cycle 200's monitor to detect, emit `harness_disengaged`, halt loop. Tests FR-019g + SC-005.
- [ ] T156 [P] Verify the constitutional alignment table in `spec.md` still maps every Principle → at least one FR; add any new FR introduced during implementation
- [ ] T157 Run `/speckit.analyze` to detect any spec/plan/tasks drift introduced during implementation
- [ ] T158 Update root `README.md` with V2's current commit SHA + Railway deploy status
- [ ] T159 Tag a `v2-002-rc1` git tag for the implementation milestone (do NOT push to main yet — main triggers Railway auto-deploy per CLAUDE.md §11)
- [ ] T160 Operator review + go/no-go for Railway redeploy

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Sibling PRs)**: Blocks everything. Within Phase 0:
  - **0a (substrate)** is highest priority (Principle V depends). Roughly 2–3 days.
  - **0b (integration)** can run in parallel with 0a but is critical-path for FR-090/FR-092. Roughly 2–3 days.
  - **0c (data)** can run in parallel with 0a + 0b — all PRs against different repos. Roughly 3–5 days but parallelizable internally.
  - **0d (temporal)** + **0e (identity/goals/coherence)** are small additive PRs; can be batched in a single afternoon each.
  - **0f (runcor retry)** is small (~½ day) and parallelizable with all others — separate engine repo. Critical-path for FR-017 with single-provider deployments.
- **Phase 1 (Setup)**: Depends on Phase 0 — needs all 14 siblings at consumable versions.
- **Phase 2 (Foundational)**: Depends on Phase 1. Internally:
  - T052–T055 (boot infra) before T072–T078 (cognitive wiring) before T079+ (dashboard).
  - T056–T059 (engine + flows) parallel to T060–T071 (local MCP module).
- **Phase 3 (US1)** = MVP. Depends on Phase 2 complete.
- **Phases 4–6 (US2, US3, US4)** can start as soon as Phase 2 is complete; mostly independent of each other (US2 = gate verification, US3 = cycle context, US4 = control parity).
- **Phases 7–10 (US5, US6, US7, US8)** can run in parallel after Phase 2.
- **Phase 11 (US9)** depends on US3 + US4 (need V2 + control writing daily summaries).
- **Phase 12 (Polish)** runs last.

### Within each Phase 0 sibling PR

- Implementation tasks before tests within the SAME PR (so tests cover the new behavior). Test tasks listed [P] because they can be authored in parallel by another developer working on the same PR.
- Version bump + PR open (last task per phase) requires all prior tasks merged into the sibling's branch.

### Parallel Opportunities (HIGH-VALUE)

- **Phase 0**: Phase 0a/0b/0c/0d/0e all run on different repos → all 5 sub-phases parallelizable across developers. With 3 developers, Phase 0 compresses to ~3 days.
- **Phase 2**: T060–T071 (10 MCP tool files) all parallelizable; T072–T078 (cognitive wiring lines) all parallelizable.
- **Phase 4 (US2) tests**: T090–T093 all parallel.
- **Phase 5 (US3) tests**: T097–T102 all parallel.
- **Phase 10 (US8) implementation**: T134–T145 all parallel (different route files).

### Parallel Example: Phase 0 (sibling PRs by 3 developers)

```text
Developer A:  Phase 0a (runcor-substrate)         — T001 → T010
Developer B:  Phase 0b (runcor-integration)       — T011 → T018
Developer C:  Phase 0c (runcor-data)              — T019 → T028
Anyone:       Phase 0d + 0e batched (small PRs)   — T029 → T040
```

### Parallel Example: Phase 2 MCP tools

```text
Task: Create src/mcp-local/tools/firecrawl-scrape.ts (T061)
Task: Create src/mcp-local/tools/inbox-read.ts       (T062)
Task: Create src/mcp-local/tools/email-send.ts       (T063)
Task: Create src/mcp-local/tools/git-push.ts         (T064)
Task: Create src/mcp-local/tools/fs-read.ts          (T065)
Task: Create src/mcp-local/tools/fs-write.ts         (T066)
Task: Create src/mcp-local/tools/fetch-chunk.ts      (T067)
Task: Create src/mcp-local/tools/web-search.ts       (T068)
Task: Create src/mcp-local/tools/publish-post.ts     (T069)
Task: Create src/mcp-local/tools/terminate.ts        (T070)
```

---

## Implementation Strategy

### MVP First (User Story 1 — Boot fails fast)

1. **Phase 0**: Sibling PRs landed (~5 days, 1 dev) or ~3 days (3 devs in parallel).
2. **Phase 1**: Setup (T041–T051) — half a day.
3. **Phase 2**: Foundational (T052–T084) — 2–3 days, parallelizable.
4. **Phase 3 (US1)**: Boot guard tests + verification — half a day.
5. **STOP and VALIDATE**: Run `npm run preflight` + `npm test` + smoke quickstart.

**MVP signal**: V2 boots cleanly with all 14 components engaged and dashboard reachable; removing any component fails closed with a clear message. This is enough to demonstrate the architectural commitment is real before spending more.

### Incremental Delivery

1. MVP (US1) → operator review → continue
2. + US2 (gate enforcement) → operator review (this is where Principle V is *demonstrated*)
3. + US3 (memory-driven cycle) → operator review (this is where the agent starts *accumulating*)
4. + US4 (control parity) → operator review (now we have a baseline to contrast against)
5. + US5–US8 (cadence, persistence, dynamic surface, dashboard) → operator review
6. + US9 (result publication) → final operator go/no-go for Railway redeploy

### Parallel Team Strategy (3 developers)

- **Phase 0**: A on substrate, B on integration, C on data (compresses to ~3 days)
- **Phase 1+2**: One dev runs setup; another stages the foundational wiring; third writes the MCP tool files (10 files all [P])
- **Phase 3+**: After foundational, the 3 devs split user stories. US2 + US3 + US4 in parallel, then US5–US8 in parallel.

---

## Notes

- **[P]** = different files / different repos / no dependencies. Most Phase-0 subphases are [P] because they target different sibling repos.
- **[Story]** maps the task to the spec user story for traceability.
- Each user-story phase is a checkpoint — operator can review before continuing.
- Tests inline with implementation per FR (the spec's test invariants are explicit in `contracts/`); no separate test-first cycle, but tests are required gates for each story.
- Commit after each task or logical group. Commits follow Conventional Commits (e.g., `feat(boot): exhaustive 14-component boot guard`).
- DO NOT push V2 to `main` until Phase 12 operator go/no-go (CLAUDE.md §11 — main pushes auto-deploy to Railway).
- Sibling PRs follow each sibling repo's existing commit conventions; bump versions before merging.
- Verify constitutional alignment after each user-story phase (Principle V is the most fragile; principles I/II are easy to drift into via prompt seeding).

---

## Quick stats

- **Total tasks**: 177 (T001–T177; sequential, no letter suffixes after analyze-remediation renumber)
- **Analyze-remediation tasks T161–T177** (slotted into their natural phase position):
  - T161–T164 (Phase 0f) — runcor intra-provider retry (FR-017)
  - T165 (Phase 1) — no-LAWS-literal lint (FR-015)
  - T166–T168 (Phase 3 US1) — cycle-0 commercial-words / memory-corruption / installer-partial-patch tests
  - T169–T170 (Phase 4 US2) — modify-verdict mapping / flag-recall reentry
  - T171 (Phase 5 US3) — summary-decay no-exemption
  - T172–T173 (Phase 10 US8) — operator routes / startup-record route splits
  - T174–T175 (Phase 11 US9) — post-terminate read-only / terminate-during-summary
  - T176–T177 (Phase 12 polish) — continuous harness monitor (FR-019g)
- **Phase 0 (sibling PRs)**: 44 tasks (substrate 10 / integration 8 / data 10 / temporal 5 / memory injection 7 / runcor retry 4)
- **Phase 1 (setup)**: 12 tasks
- **Phase 2 (foundational)**: 33 tasks
- **User-story phases**: 76 tasks across US1 (8), US2 (10), US3 (12), US4 (6), US5 (4), US6 (7), US7 (4), US8 (19), US9 (6)
- **Polish**: 12 tasks
- **MVP (US1) scope**: T001 → T089 + T166–T168 (~92 tasks; ~7–8 working days for a single developer, ~5 with 3 parallelizing Phase 0 + Phase 2)
- **Parallel-tagged tasks**: ~120 of 177 (~68%) — high parallelism opportunity
