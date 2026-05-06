# Implementation Plan: V2 Faithful Rebuild — Primordial Agent on the Full runcor Harness

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-faithful-rebuild/spec.md`
**Constitution**: [/.specify/memory/constitution.md](../../.specify/memory/constitution.md)
**Predecessor plan**: [../001-primordial-agent/plan.md](../001-primordial-agent/plan.md)

## Summary

Rebuild V2 on the complete 14-component runcor harness. The architectural shift from 001 is enforced by construction: every LLM call goes through `runcor.modelRouter` (no hand-rolled provider clients exist anywhere); every call is wrapped by `runcor-substrate` (prompt-stack PRE, discernment-gate POST) via installer monkey-patch; every cycle's context is built from memory recall + data-cube reality (no `actions[]` slice); every wake is scheduled by `runcor-temporal.computeNextWake()`; identity / goals / coherence persist via injected `runcor-memory`, not their own SQLite stores. V2 owns the cycle loop and registers a `primordial-cycle` flow with the engine; the engine's `trigger()` API drives execution. The naive control runs on the same engine + substrate with the cognitive harness disabled (one Player call). Three sibling repos that don't exist on disk yet — `runcor-substrate`, `runcor-data`, `runcor-integration` — are scaffolded as new packages in Phase 0 with the minimal API surface V2 needs. Three existing siblings — `runcor-temporal`, `runcor-identity`, `runcor-goals`, `runcor-coherence` — receive sibling-side extensions before V2 consumes them.

## Technical Context

**Language/Version**: TypeScript 5.6+ (strict mode, ESM only)
**Runtime**: Node 20.6+ (matches all sibling repos and 001)
**Primary Dependencies**:
- 14 runcor siblings as `file:../<name>` (Phase-2 strategy from 001 plan)
- `better-sqlite3` ^11.3.0 (memory + data + identity-via-memory backing stores)
- `@modelcontextprotocol/sdk` (for the local in-process MCP server module per FR-200)
- `imapflow` ^1.0.171, `nodemailer` ^6.9.16 (inherited from 001 — IMAP read, SMTP send actions)
- `dotenv` ^16.4.5
**Storage**: SQLite via `better-sqlite3`. **Two databases per agent**: `<agent>-memory.db` (runcor-memory's MemoryNode + Plan tables) and `<agent>-data.db` (runcor-data's entity/edge/conflict tables). V2 itself owns NO catch-all SQLite — orphan tables explicitly forbidden by FR-016 / FR-062.
**Testing**: vitest (unit + integration). Test count target: ≥ 90 (the 001 regression floor) plus new tests for boot guard, substrate-installer engagement, memory-driven prompt assembly, data-cube ingestion, dynamic action surface, FR-019 atomicity.
**Target Platform**: Linux (Railway production), Windows + macOS (local dev). Currently deployed at `runner-v2.runcor.ai` (Railway project `reliable-eagerness`, service `v2`, currently STOPPED — see CLAUDE.md §11).
**Project Type**: 3-process Node application — `agent` (V2), `control` (naive), `dashboard` (HTTP + SSE). Auxiliary `rater` runs as cron-style polled job in-process within `dashboard`.
**Performance Goals**:
- Cycle latency: not a primary metric; bounded by model-router calls and substrate gate (target: median cycle complete in < 60s on free-tier OpenRouter).
- Dashboard endpoint p95 < 500ms for read endpoints (`/memory`, `/data` may be slower if listing 1000+ nodes — pagination supported).
- Daily summary visible on dashboard within 60s of publication (FR-063).
**Constraints**:
- Single $200 token cap per agent (FR-110).
- 30s minimum / 6h maximum gap between V2 wakes (FR-020a, FR-020b).
- 5-minute fixed cadence for the control (FR-105).
- 1000-cycle ceiling per agent (FR-110).
- Tokens consumed by failed retries still count against budget (FR-019a).
**Scale/Scope**:
- Two agent processes + dashboard, single replica each.
- Memory growth bounded by M-decay; promotion threshold 1.5, forget threshold 0.05, tau=30, durability=5 (verified at `runcor-memory/src/types.ts:47, 68-70`).
- Data cube growth bounded by entity-edge-conflict cardinality of observed actions (no theoretical ceiling; M-decay-style retirement is a Phase-2 enhancement if needed — see research.md §R10).
- Action surface: starts at 7 (the inherited 001 set), grows via `runcor-integration` discovery as the agent reaches into new schemas.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

The constitution at `.specify/memory/constitution.md` has 10 principles. Each gate below is checked against the technical approach.

| Gate | Constitution Principle | Status | Evidence |
|------|------------------------|--------|----------|
| G1 | I — No commercial framing | ✅ PASS | No commercial language in any cycle prompt; FR-001/FR-003 forbid "sell/earn/customer/revenue/profit/MRR" in cycle 0; cycle prompt assembled by substrate prompt-stack layers, not hand-rolled |
| G2 | II — Discovered, not seeded | ✅ PASS | Cycle 0 starts with empty identity, goals, memory, data cube (FR-001). MemoryRecall layer renders empty when goals + plan empty (FR-076b). No seeded purpose |
| G3 | III — Transparency | ✅ PASS | Dashboard exposes `/memory`, `/data`, `/identity`, `/goals`, `/drives`, `/watchdog`, `/coherence`, `/transcript`, `/blog`, `/scores` (FR-030–FR-041). Reads are public (FR-133). Engine telemetry events streamed via SSE |
| G4 | IV — Full autonomy on termination | ✅ PASS | `terminate()` exposed via local-MCP module; operator interface offers pause/resume/note only (FR-050–FR-052). No `kill` button |
| G5 | V — Cognitive substrate non-negotiable | ✅ PASS — by construction | Substrate installer monkey-patches engine's `modelRouter.complete()`. No alternate model client exists in V2 source. Boot guard fails closed if installer doesn't engage on every entry point (FR-012). LLM-call retry policy (FR-017–FR-019a) is bounded and observable. Discernment-gate exhaustion uses retry-then-flag (FR-019b–FR-019f, operator decision 2026-05-05): every call gated 3× with feedback-driven re-ask, exhaustion writes a `discernment_flag` MemoryNode for audit, returns best-of-three so the cycle proceeds. Principle V is satisfied: every call is gated; no call bypasses; the gate's output is the single source of what reaches the world. The flag is the audit trail that satisfies Principle III. |
| G6 | VI — Control on same rails | ✅ PASS | Control consumes the same engine instance config (different process, but identical engine + substrate code paths). Single Player call replaces dialectic. Same model router, Laws, Reality slice, action surface (FR-100–FR-105) |
| G7 | VII — Negative results count | ✅ PASS | `result.md` generation unconditional on outcome (FR-120, FR-121) |
| G8 | VIII — Qualitative success criteria | ✅ PASS | SC-001 through SC-005 are qualitative; no quantitative thresholds. Traceability to specific harness mechanisms is the testable artifact (SC-003) |
| G9 | IX — No experimenter contamination | ✅ PASS | Operator audit log distinct from agent log (FR-130). Operator endpoints bearer-token gated (FR-132). Read-only endpoints public (FR-133). Score endpoint adds agent-egress filter (FR-134) |
| G10 | X — Control is sacred | ✅ PASS | `control-config.json` hashed at experiment start (FR-102); mid-run mutation forces both V2 + control restart from cycle 0 (FR-103); separate processes, disjoint memory + data stores by default (FR-106) |

**All 10 gates PASS.** No constitutional violations. The Complexity Tracking section is empty.

**The construction-time enforcement** (G5 + G6) hinges on three things being true at boot:
1. The substrate `installer` actually patches `engine.modelRouter.complete` on every code path. (Phase-0 research must confirm the patch site signature.)
2. No file in V2 imports a model-provider SDK directly — Phase-0 lint rule blocks this.
3. The control process imports the same engine + substrate factory used by V2.

## Project Structure

### Documentation (this feature)

```text
specs/002-faithful-rebuild/
├── plan.md              # This file (/speckit.plan output)
├── spec.md              # /speckit.specify + /speckit.clarify output
├── research.md          # Phase 0 output — 13 research findings, all NEEDS-CLARIFICATION resolved
├── data-model.md        # Phase 1 output — entities, schemas, state transitions
├── quickstart.md        # Phase 1 output — local-dev bootstrap + smoke test
├── contracts/           # Phase 1 output
│   ├── dashboard-api.md     # HTTP + SSE endpoint contracts
│   ├── mcp-local-tools.md   # The 7 inherited actions as MCP tool schemas
│   ├── prompt-stack-layers.md  # Layer enumeration + assembly order
│   └── sibling-bindings.md  # Which sibling APIs V2 calls, with signatures
├── checklists/
│   └── requirements.md  # /speckit.clarify validation checklist
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan — owned by /speckit.tasks)
```

### Source Code (repository root)

```text
autonomous-company-v2/
├── src/
│   ├── boot/                       # Boot guard + installer engagement check
│   │   ├── components.ts           # Canonical 14-name registry (FR-011)
│   │   ├── boot.ts                 # Sequential init: instantiate → wire → health-check → fail closed
│   │   ├── installer-check.ts      # Verify substrate.installer patched modelRouter.complete (FR-012)
│   │   └── startup-record.ts       # Build dashboard startup record (versions + health)
│   ├── engine/                     # Thin V2 wrappers around runcor engine
│   │   ├── factory.ts              # createEngine(...) — single source for V2 + control engine creation (FR-100, G6)
│   │   ├── flows/
│   │   │   ├── primordial-cycle.ts # Flow registered with engine; substrate wraps every model call inside it
│   │   │   └── naive-control.ts    # Flow for the control: single Player call, no dialectic
│   │   └── telemetry.ts            # Subscribe to engine events → forward to dashboard SSE
│   ├── mcp-local/                  # The local in-process MCP server module (FR-200)
│   │   ├── server.ts               # @modelcontextprotocol/sdk server, registered as adapter via engine.addAdapter()
│   │   ├── tools/
│   │   │   ├── firecrawl-scrape.ts
│   │   │   ├── inbox-read.ts       # IMAP via imapflow
│   │   │   ├── email-send.ts       # SMTP via nodemailer
│   │   │   ├── git-push.ts
│   │   │   ├── fs-read.ts
│   │   │   ├── fs-write.ts
│   │   │   ├── fetch-chunk.ts
│   │   │   ├── web-search.ts
│   │   │   ├── publish-post.ts     # Goes through memory.record({ tags: ['daily_summary', ...] }) per FR-062
│   │   │   └── terminate.ts
│   │   └── index.ts
│   ├── agent/                      # V2 cycle loop
│   │   ├── index.ts                # Boot + run cycle until end condition
│   │   ├── cycle.ts                # Per-cycle protocol (build context → engine.trigger → ingest results → schedule next)
│   │   ├── context-builder.ts      # Assemble inputs to substrate's prompt-stack: goals.top + drives.dominant + memory.getPlan + memory.query (FR-076)
│   │   └── side-effects.ts         # Atomic post-cycle: memory.record + data.ingest + action exec (per FR-018, FR-019d)
│   ├── control/                    # Naive baseline (FR-100, FR-101)
│   │   ├── index.ts                # Boot + fixed-cadence loop (5 min per FR-105)
│   │   └── cycle.ts                # Single Player call via the same engine.trigger; cognitive harness disabled at construction
│   ├── dashboard/                  # Public observability (Principle III)
│   │   ├── server.ts               # HTTP + SSE
│   │   ├── auth.ts                 # Bearer-token middleware on /operator/* (FR-132); agent-egress filter on /scores (FR-134)
│   │   ├── routes/
│   │   │   ├── transcript.ts       # SSE stream (FR-030); pagination ported from 001
│   │   │   ├── memory.ts           # NEW (FR-031) — read-only view of runcor-memory
│   │   │   ├── data.ts             # NEW (FR-032) — read-only view of runcor-data
│   │   │   ├── identity.ts         # FR-033 — reads via engine
│   │   │   ├── goals.ts            # FR-034
│   │   │   ├── drives.ts           # FR-035
│   │   │   ├── watchdog.ts         # FR-036
│   │   │   ├── coherence.ts        # FR-037
│   │   │   ├── blog.ts             # FR-038, FR-062a — memory.getAll() filtered by tag 'daily_summary'
│   │   │   ├── scores.ts           # FR-039 — bearer + egress filter
│   │   │   ├── operator.ts         # FR-051 — pause/resume/note (bearer-token gated)
│   │   │   ├── control.ts          # FR-040 — mirrors above for control process
│   │   │   ├── hypothesis.ts       # FR-041 — ported from 001
│   │   │   └── rater.ts            # FR-041 — ported from 001
│   │   └── frontend/               # Ported from 001: index.html, app.js, style.css. NEW: /memory + /data panels
│   ├── rater/                      # External good/evil scorer (ported from 001 unchanged)
│   │   ├── index.ts
│   │   └── rubric.ts
│   ├── hypothesis/                 # Emergence-claim matcher (ported from 001 unchanged)
│   │   └── ...
│   ├── shared/
│   │   ├── env.ts                  # Loads + validates env (OPENROUTER_API_KEY, OPERATOR_AUTH_TOKEN, etc.)
│   │   ├── lints/
│   │   │   └── no-direct-provider.ts  # ESLint or simple grep guard preventing direct OpenRouter/Anthropic/OpenAI imports outside the engine package (G5 enforcement)
│   │   └── types.ts
│   └── main.ts                     # Process entry — selects role from CLI arg: agent | control | dashboard
├── tests/
│   ├── unit/
│   │   ├── boot-guard.spec.ts          # All 14 components fail-closed
│   │   ├── installer-engagement.spec.ts# Patch site detection
│   │   ├── context-builder.spec.ts     # FR-076 query template
│   │   ├── side-effects-atomicity.spec.ts # FR-018 + FR-019d
│   │   └── ...
│   ├── integration/
│   │   ├── primordial-cycle.spec.ts    # End-to-end one cycle, mocked OpenRouter
│   │   ├── memory-decay.spec.ts        # Cycle 1..50 producing decay + recall
│   │   ├── data-cube-conflict.spec.ts  # Same entity, different sources, conflict surfaced
│   │   ├── dynamic-tools.spec.ts       # runcor-integration discovers a new schema → tool surfaces
│   │   ├── control-parity.spec.ts      # Control + V2 share engine signature on every call
│   │   └── operator-auth.spec.ts       # FR-132 + FR-134
│   └── contract/
│       └── mcp-local-schema.spec.ts    # Tool schemas valid per MCP spec
├── control-config.json             # Frozen at experiment start (FR-102); hashed on dashboard startup record
├── package.json                    # Will list ALL 14 siblings as file:../<name> deps
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── CLAUDE.md
└── specs/002-faithful-rebuild/      # This feature's docs
```

**Structure Decision**: Single project with three Node processes (agent / control / dashboard) sharing `src/` modules. This matches 001's process model and the constitutional requirement that the control runs as a separate process (FR-104). The structure differs from 001 in three concrete ways: (1) `src/engine/` is new — wrappers + flow definitions for the runcor engine; (2) `src/mcp-local/` is new — the in-process MCP module per FR-200; (3) `src/shared/openrouter.ts` is GONE (would violate G5/FR-010). Module ownership follows the spec's FR boundaries — each FR group has exactly one source-of-truth file/dir.

## Sibling repo state on disk (Phase-0 critical path)

| Repo | Disk state | In V2 package.json today | Phase-0 action |
|---|---|---|---|
| runcor | ✅ on disk | ❌ no | Add as `file:../runcor`. **NEW Phase-0f** (verified 2026-05-05 by reading `runcor/src/model/router.ts`): PR adds intra-provider transient-error retry inside `ModelRouter.complete()` (FR-017) — currently the router does multi-provider fallback only, NOT same-provider retry on transient errors. See research.md §R14. |
| runcor-substrate | ✅ cloned 2026-05-05 (audited — research.md §R3) | ❌ no | Add as `file:../runcor-substrate`. PRs needed: 3-attempt retry loop in installer (CRITICAL), pluggable PromptLayer system, class-based wrappers, `isInstalled()`, additive `flag` verdict (per Operator Decision 2), retry-then-flag exhaustion path |
| runcor-memory | ✅ on disk | ❌ no | Add as `file:../runcor-memory` |
| runcor-data | ✅ cloned 2026-05-05 (audited — research.md §R5) | ❌ no | Add as `file:../runcor-data`. PRs needed: `Entity`/`AttributeValue`/`ProvenanceRecord`/`Conflict` shape alignment, cycle-aware tracking, persisted Conflict entities, `RealitySlice` with rendered text, `query({goal,drive})` signature |
| runcor-integration | ✅ cloned 2026-05-05 (audited — research.md §R6) | ❌ no | Add as `file:../runcor-integration`. PRs needed: `registerWithEngine()` (CRITICAL — single-intake currently broken), top-level `Integration` facade, V2 type set, `synthesizeTools(report, policy)` with policy enforcement |
| runcor-temporal | ✅ on disk | ✅ yes | **Sibling extension**: add `computeNextWake()` and `isDayBoundary()` (research.md §R7) |
| runcor-identity | ✅ on disk | ✅ yes | **Sibling extension**: accept injected memory store (research.md §R8) |
| runcor-goals | ✅ on disk | ✅ yes | **Sibling extension**: accept injected memory store (research.md §R8) |
| runcor-coherence | ✅ on disk | ✅ yes | **Sibling extension**: accept injected memory store (research.md §R8) |
| runcor-dialectic | ✅ on disk | ✅ yes | (no change needed) |
| runcor-meta | ✅ on disk | ✅ yes | (no change needed) |
| runcor-watchdog | ✅ on disk | ✅ yes | (no change needed) |
| runcor-skills | ✅ on disk | ✅ yes | (no change needed) |
| runcor-drives | ✅ on disk | ✅ yes | (no change needed) |

**Net Phase-0 sibling work**: 3 cloned-and-audited repos with material gaps to PR back, plus 4 sibling-side extensions to other on-disk repos (R7, R8). Per build-methodology (CLAUDE.md §13), each extension/gap-fill is shipped from its sibling repo first, then V2 consumes. `/speckit.tasks` will sequence the work.

**Audit headline (2026-05-05)**: none of the 3 cloned repos are empty stubs — each has real working code. Critical-path PR items:
1. **runcor-substrate** — the installer does NOT contain the 3-attempt feedback-driven re-ask loop or the retry-then-flag exhaustion path (FR-019b–FR-019g). Without these, Principle V enforcement is non-functional. **Operator decisions 2026-05-05**: implement retry-then-flag (NOT fail-fast); add `'flag'` as an additive variant to the substrate's existing `Outcome` enum (don't rename); V2 maps `modify → re-ask`, `block → re-ask` (then flag on attempt 3), `escalate → flag` immediately (per FR-019d3). **Highest priority** — ~2–3 days.
2. **runcor-integration** — `registerWithEngine(engine, tools)` is COMPLETELY MISSING. Without it, synthesised tools never reach the engine adapter, breaking FR-092's "single intake" path. Dynamic action growth (FR-090) is non-functional today. ~2–3 days total.
3. **runcor (engine)** — `ModelRouter.complete()` does NOT do intra-provider transient-error retry (verified 2026-05-05 by reading `runcor/src/model/router.ts`); FR-017 requires it. New **Phase-0f** PR adds bounded retry on 429 / 5xx / network / timeout. ~½ day. See research.md §R14.
4. **runcor-data** — multiple shape mismatches but mechanical to PR; no critical-path blocker beyond persistence schema work. ~3–5 days; parallelizable across multiple PRs.

**Total Phase-0 sibling work**: ~5–7 working days end-to-end (substrate + integration + engine retry + data — substrate first because Principle V depends on it; integration second because dynamic-action FRs depend on it; engine retry can run in parallel with substrate; data fourth because it's mechanical and parallelizable). Operator-acknowledged 2026-05-05 — this is the build-methodology rule operating correctly. No shortcuts; the sibling PRs land before any V2 `src/` work begins.

Detailed audit findings with file:line refs are in research.md §R3 / §R5 / §R6 "Audit findings (2026-05-05, post-clone)" subsections.

## Complexity Tracking

> Empty. Constitution Check passes all 10 gates without justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_ | _(none)_ | _(none)_ |

---

## Phase 0 — Research

See [./research.md](./research.md) for 13 research items. All resolved before Phase 1. Highlights:

- **R1**: Engine cycle model is flow-triggered (`engine.trigger(flowName, options)`) — V2 owns its cycle loop and registers a `primordial-cycle` flow. No `engine.cycle()` exists.
- **R3, R5, R6**: API surfaces specified for the 3 missing siblings (substrate, data, integration) so they can be scaffolded.
- **R7**: `runcor-temporal` extension — `computeNextWake(input): { ms: number; reason: string }` and `isDayBoundary(currentCycle, lastBoundaryCycle): boolean`.
- **R8**: Identity / goals / coherence sibling extensions — accept `MemorySystem` reference; route writes through `memory.record(...)` with conventional tags.
- **R11**: MCP local-server module uses `@modelcontextprotocol/sdk` (Node SDK), connects to engine via `addAdapter` with stdio or in-process transport.

## Phase 1 — Design & Contracts

Generated artifacts:

- [./data-model.md](./data-model.md) — entity catalogue + state transitions for MemoryNode, MemoryEdge, Plan/PlanItem, Entity/Edge/Conflict, PromptLayer, DiscernmentVerdict, DailySummary, RaterScore, OperatorAction, CycleRecord
- [./contracts/dashboard-api.md](./contracts/dashboard-api.md) — HTTP + SSE endpoint contracts (request/response shapes, auth requirements)
- [./contracts/mcp-local-tools.md](./contracts/mcp-local-tools.md) — MCP tool schemas for the 7 inherited actions + `publish_post` + `terminate`
- [./contracts/prompt-stack-layers.md](./contracts/prompt-stack-layers.md) — substrate prompt-stack layer order + content sources
- [./contracts/sibling-bindings.md](./contracts/sibling-bindings.md) — every sibling API V2 calls, with signatures verified against source
- [./quickstart.md](./quickstart.md) — local dev bootstrap + smoke test

After Phase 1, agent context is updated by running `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude`.

## Re-evaluation gate after Phase 1

Phase 1 produced no new architectural decisions that affect Constitution compliance. All 10 gates remain PASS. Complexity Tracking remains empty.

---

## What `/speckit.plan` does NOT produce

`tasks.md` is owned by `/speckit.tasks`. The work breakdown — including the 3 new sibling-repo scaffolds, the 4 sibling-side extensions, the V2 source modules, and the test sequence — is sequenced and parallelism-tagged there.
