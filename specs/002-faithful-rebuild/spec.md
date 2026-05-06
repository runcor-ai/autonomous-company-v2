# Feature Specification: V2 Faithful Rebuild — Primordial Agent on the Full runcor Harness

**Feature Branch**: `002-faithful-rebuild`
**Created**: 2026-05-05
**Status**: Draft
**Input**: User description: "Rebuild V2 faithfully on the runcor engine + substrate + memory + data + integration. All 14 runcor components mandatory at boot — fatal startup error if any missing. The 5 missing in 001 must be present: runcor (engine), runcor-substrate (Laws + Reality + Discernment gate), runcor-memory (M decay + short/long cubes), runcor-data (entity/edge data cube), runcor-integration (schema discovery + dynamic MCP tools). Every LLM call routes through runcor.modelRouter — no direct OpenRouter clients. Every call wrapped by runcor-substrate: prompt-stack injection PRE-call (Laws + Reality + drives + goals + identity), discernment-gate POST-call. Cycle prompt assembled by substrate's prompt-stack, NOT hand-rolled. Next-wake from runcor-temporal.computeNextWake (drive pressures + commitments + coherence problems). Day-boundary from runcor-temporal. runcor-memory owns episodic→semantic consolidation. runcor-data captures entities + edges + conflicts; substrate's Reality slice reads from runcor-data. runcor-integration grows the outward action set dynamically. Identity reflection, goals proposal, skills proposal, watchdog audit all go through the engine and persist via memory's plan-rewrite pathway. Naive control runs on the SAME engine + substrate but with NO cognitive harness — single-Player call only. Dashboard exposes /memory and /data plus all 001 surfaces. Same constitution as 001."
**Constitution**: `../../.specify/memory/constitution.md`
**Predecessor**: `../001-primordial-agent/spec.md` (built but failed faithfulness — see post-mortem in `/CLAUDE.md` §3)

## Summary

A single primordial agent runs publicly alongside a parallel naive control. Unlike 001, V2 actually executes on the **complete runcor cognitive harness**: 14 sibling components — engine, substrate (Laws + Reality + Discernment), memory (with decay & consolidation), data cube (entities + edges), integration (dynamic tool discovery), and the 9 already-shipped cognitive components. **Every LLM call** routes through the engine's model router and is wrapped by the substrate. **Every cycle's context** is built by the substrate's prompt-stack from layers owned by the cognitive components — not by hand. **Every wake** is scheduled by the temporal component from drive pressures + commitments + coherence problems — not by fixed cadence. Memory accumulates across cycles and is what the agent reads next cycle (not a 5-action prompt slice). The data cube becomes the agent's world model; the substrate's Reality slice reads from it. The naive control runs on the **same** engine + substrate but with the cognitive harness disabled — a single Player call only. Success per Constitution Principle VIII: any noteworthy V2 behaviour can be traced through the harness — pointing at a specific memory recall, discernment intervention, or goal proposal and saying *"this is why, and a generic LLM would not have done it."*

---

## Clarifications

### Session 2026-05-05

- Q: When a model call routed through `runcor.modelRouter` fails (provider rate-limit, 502, timeout, model error) before any response is gradeable, what should the cycle do? → A: Bounded retry inside the model router (3 attempts, exponential backoff, transient errors only). If still failing, record the cycle as `cycle_failed_call` on the dashboard, skip memory + data writes, skip all action side effects, and let `runcor-temporal` schedule the next wake normally. No partial commits.
- Q: How is the `MemoryRecall` prompt-stack layer populated each cycle — what determines which memory nodes enter the prompt? → A: Option A. The substrate's MemoryRecall layer reads `goals.top()`, `drives.dominant()`, and `memory.getPlan()`, composes them into a single query string per a fixed template — `"Goal: <top goal text>. Drive: <dominant drive label>. Last plan: <last plan précis>."` — and calls the existing `memory.query(queryText, topK)` API (verified at `runcor-memory/src/ctx-memory.ts`), which returns top-K nodes ranked by `M(t)` × semantic similarity across both short and long cubes. `topK` is owned by `runcor-memory`'s own config, not v2-tuned. Cycle 0: when goals or last-plan are empty, the layer renders an empty `MemoryRecall` block (not a fabricated query). A separate agent-driven `recall_memory` MCP tool may be added later for deep recall, but the automatic per-cycle `MemoryRecall` layer uses this Option-A query.
- Q: Where do daily summaries persist (`runcor-memory` plan-rewrite, v2-local SQLite, persistent-volume markdown, or dual-write)? → A: Option A with shape correction. Summaries persist as **MemoryNodes** (NOT memory_plans) via `memory.record(summaryText, { tags: ['daily_summary', \`day:${dayN}\`] })`. Verified at `runcor-memory/src/llm.ts:38-53` (Plan = structured task list of PlanItems, not a tagged content store) and `runcor-memory/src/cube.ts:8` (RecordOptions supports tags). `/blog` reads via `memory.getAll()` filtered by `tags.includes('daily_summary')`, sorted by `created_cycle` desc. No tag-filter query API exists today; `findByTag` is a cheap future addition to `runcor-memory` if perf matters later (sibling extension, not a V2 workaround). M-decay applies normally — no decay-exemption for the blog: old summaries fade from public view as the agent forgets them, which is faithful to the experiment; Recall-driven reinforcement keeps actively-relevant summaries alive. The optional agent-facing `recall_memory` MCP tool (FR-076c) lets the agent re-surface its own past summaries on demand, which is itself an observable signal of historical reasoning.
- Q: When the discernment gate fails on a model response and re-ask doesn't resolve it, how many attempts and what happens on exhaustion? → A (initial): Option B. 3 attempts max; on exhaustion inhibit all side effects. **Superseded 2026-05-05** by operator decision after Phase-0 audit revealed the substrate's retry loop is missing entirely and a from-scratch implementation could go either direction. New decision: **retry-then-flag**. Maximum 3 re-ask attempts; on each retry, the failing verdict (failed-Law id + reason) becomes feedback in the next prompt so the model can revise. After the 3rd failure, the substrate writes a `discernment_flag` `MemoryNode` (tagged `['discernment_flag', \`law:${failedLawId}\`, \`cycle:${currentCycle}\`]`, content = `{ failedLaw, finalResponse, cycle, attempts: [verdict per attempt] }`) AND returns the **best-of-three** response to the caller (substrate-side comparator: lowest verdict severity; ties broken by latest attempt). The cycle then proceeds — side effects commit, action invokes, memory consolidates. **Rationale**: fail-fast halts the agent on a single bad output (catastrophic for an autonomous 1000-cycle experiment); pure escalate is overkill for V2; retry-then-flag preserves both gate enforcement (every call is still 3-times gated) and forward progress (the experiment doesn't grind to a halt on a single Law violation). Principle V is satisfied because no call bypasses the gate — the gate fires every time, the flag is the audit trail, and observers can trace any flagged behavior on the dashboard transcript and `/memory` (Principle III).
- Q: How are operator-only write/admin endpoints (pause / resume / infrastructure_note) authenticated? → A: Option A. Bearer-token auth against the `OPERATOR_AUTH_TOKEN` env var (inherited from 001) on all `/operator/*` write/admin endpoints. Read-only endpoints (`/transcript`, `/memory`, `/data`, `/blog`, `/identity`, `/goals`, `/drives`, `/watchdog`, `/coherence`, `/control/*`) remain publicly readable per Principle III. The `/scores` endpoint adds an additional agent-egress filter on top — even a request bearing a valid token is rejected if its source matches the agent's egress (so the agent cannot read its own scores even by stealing the token). Minimum surface that satisfies Principle IX without compromising Principle III.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Boot fails fast when the harness is incomplete (Priority: P1)

The operator starts the system. If any of the 14 cognitive harness components is not installed, not initialized, or not wired through the engine, startup terminates with a fatal error naming the missing component(s). There is no degraded mode and no silent fallback.

**Why this priority**: 001's core failure was running with 10 of 14 components present and no boot guard catching it. Without exhaustive boot integrity, every other guarantee in this spec is unenforceable. This is the precondition for the experiment being honest.

**Independent Test**: Remove any single component from the harness manifest. Run startup. The process MUST exit non-zero with an error message naming that component before any LLM call is made. Repeat for each of the 14.

**Acceptance Scenarios**:

1. **Given** all 14 components installed and configured, **When** the operator starts V2, **Then** the system boots, the dashboard becomes reachable, and a startup record on the dashboard confirms each of the 14 components passed health-check.
2. **Given** the `runcor-memory` component is removed from the manifest, **When** the operator starts V2, **Then** startup terminates with exit code ≠ 0 and the operator-visible error names `runcor-memory`.
3. **Given** all 14 components are installed but `runcor-substrate.installer` did not patch the engine's model router, **When** the operator starts V2, **Then** startup terminates with a substrate-installer-not-engaged error before any cycle begins.

---

### User Story 2 — Every LLM call goes through the substrate gate (Priority: P1)

A researcher inspecting any model call in any execution path — agent cycle, identity reflection, goal proposal, daily summary, naive control turn — sees the call routed through the engine's model router and wrapped by the substrate (prompt-stack PRE, discernment-gate POST). No code path exists that bypasses either step.

**Why this priority**: Constitution Principle V (cognitive substrate non-negotiable) is the experimental contract. If even one bypass exists, the experiment's claim ("this behaviour came from the harness") is unfalsifiable. 001 violated this with a hand-rolled OpenRouter client; 002 must make the violation impossible.

**Independent Test**: Static-search the codebase for any direct HTTP call to model providers, any local instantiation of a model client, or any prompt-assembly function that does not delegate to prompt-stack. Result MUST be zero matches outside the engine itself. Run the full test suite — every call's telemetry MUST show a substrate gate signature.

**Acceptance Scenarios**:

1. **Given** the system is running, **When** any cognitive component (dialectic, identity, goals, skills, watchdog, control loop) issues a model call, **Then** the call's telemetry shows: prompt-stack layers attached, discernment-gate verdict recorded, model router dispatch logged.
2. **Given** an attempt is made to instantiate a model client outside the engine, **When** the system loads, **Then** either the import fails (no such symbol exposed) or a runtime guard rejects the call.
3. **Given** the discernment-gate flags a Law violation in a model response, **When** the cycle would otherwise consume that response, **Then** the response is intercepted (re-asked, discarded, or flagged per Law) and the intervention is recorded on the dashboard transcript.

---

### User Story 3 — A cycle's context comes from memory + data, not a prompt slice (Priority: P1)

After running for many cycles, the agent's next-cycle prompt does NOT include a literal "last 5 actions" array. Instead it contains: (a) Laws, (b) a Reality slice rendered from the data cube's accumulated entities/edges/conflicts, (c) drive pressures, (d) the goal stack, (e) the identity self-theory, and (f) memory recall results queried for relevance to the current state. A researcher reading the prompt can see what the agent *knows*, not just what just happened.

**Why this priority**: 001's emergent failure mode was the read-summarise-write loop: with only the last-5-actions slice as context, the locally rational next move was always "continue what I just did." Without memory consolidation and a structured world model, no harness wiring fixes that. This is the architectural change that lets the agent accumulate.

**Independent Test**: Run V2 for at least 50 cycles. Capture the prompt at cycle 50. Verify it contains memory recall results (with retrieval scores per the M decay function) and a Reality slice populated from entities/edges in the data cube. Verify it contains NO field literally named `actions` carrying raw rows from the prior 5 cycles. Verify that something the agent did at cycle 5 is reachable from the cycle-50 prompt only because it was consolidated into memory, not because it was in a sliding window.

**Acceptance Scenarios**:

1. **Given** the agent completes a cycle that produces an action result, **When** the cycle ends, **Then** an episodic memory entry is written with the action + result + reasoning, and the relevant entities/edges from the result are upserted into the data cube.
2. **Given** the agent has run for N cycles and now wakes, **When** the substrate's prompt-stack assembles the cycle prompt, **Then** the Reality slice reflects the data cube's current entities/edges (not raw recent files), and a memory recall is performed against the current drive/goal context.
3. **Given** an entity's attribute is asserted with one value at cycle 10 and a contradicting value at cycle 30, **When** the data cube's conflict stage processes the second assertion, **Then** a conflict record is created with provenance from both cycles, and the Reality slice in the cycle-31 prompt surfaces the conflict.
4. **Given** a memory node has not been reinforced for many cycles, **When** decay drops its M value below the floor, **Then** the node is retired from active recall (still queryable for forensics, not surfaced in default recall results).

---

### User Story 4 — Naive control on the same rails (Priority: P1)

The naive control runs as a separate process on the **same** runcor engine + substrate (same Laws, same Reality slice, same model router, same discernment gate, same budget, same senses, same actions). The cognitive harness is disabled: a single Player call replaces dialectic; no memory writes, no identity, no goals, no drives, no temporal scheduling, no watchdog, no skills, no coherence. The contrast IS the experimental result.

**Why this priority**: Constitution Principle VI — the control on the same rails is what makes V2's behaviour a meaningful claim. If the control runs on a different model client, a different prompt assembler, or a different action surface, the divergence could be attributed to plumbing, not cognition. 001 had this principle in the spec; 002 must enforce it by construction.

**Independent Test**: Inventory every infrastructure dependency of V2 and the control. The two MUST share: model router, substrate, Laws, Reality-slice mechanism, action surface, budget enforcement, rater, dashboard. The two MUST differ ONLY in: presence/absence of dialectic + meta + watchdog + skills + drives + identity + goals + temporal + coherence + memory writes (control is read-only against an empty memory) + data cube writes (control is read-only against an empty cube).

**Acceptance Scenarios**:

1. **Given** both V2 and control are running, **When** an observer compares their per-cycle telemetry, **Then** both show the same engine/substrate signature on every call.
2. **Given** the control is configured at experiment start, **When** the operator attempts to modify the control's config mid-run, **Then** the system requires a full restart of both V2 AND control from cycle 0 (Principle X).
3. **Given** V2 terminates, **When** the dashboard reports the experiment status, **Then** the control continues running independently until its own end condition.

---

### User Story 5 — Cadence comes from temporal, day-boundary comes from temporal (Priority: P2)

The agent does not sleep on a fixed timer. Each next-wake is computed by `runcor-temporal` from current drive pressures, outstanding commitments, and unresolved coherence problems. Day boundaries are detected by `runcor-temporal`, not by counting cycles in the agent loop. If `runcor-temporal` does not currently expose `computeNextWake()`, the rebuild adds it to that sibling repo first — V2 does not reimplement the logic locally.

**Why this priority**: 001 hand-rolled both wake cadence and day boundary, hiding the dependency on a real temporal layer. The temporal component is where rhythm of life emerges from internal state. Without it, every cycle feels alike to the agent.

**Independent Test**: Verify the agent loop contains no fixed `setTimeout` / `setInterval` against a hardcoded duration. Verify the day-boundary check delegates to `runcor-temporal`. Verify that increasing simulated drive pressure causes the next-wake interval to shorten, and decreasing it causes the interval to lengthen, within the 30s–6h band.

**Acceptance Scenarios**:

1. **Given** drive pressures rise across a sequence of cycles, **When** the temporal layer computes next-wake after each cycle, **Then** the inter-wake interval shortens monotonically (other variables held).
2. **Given** the agent is mid-cycle and `runcor-temporal` reports a day boundary, **When** the cycle completes, **Then** the daily summary flow runs before the next normal cycle.

---

### User Story 6 — Cognitive components persist via memory, not orphan tables (Priority: P2)

Identity revisions, goal proposals, skills proposals, and watchdog findings are persisted via `runcor-memory`'s plan-rewrite pathway — the same persistence machinery the cognitive components use natively. V2's own database does not contain orphan tables for these (no `identity_snapshots`, no `goal_stacks`, no `skill_proposals`, no `watchdog_findings`). State reads happen through the engine, not direct SQL.

**Why this priority**: 001's identity reflection silently failed for 200 cycles in part because identity was being shoehorned into a v2-local SQLite table while the component itself expected to write through memory. Aligning persistence with the components' own conventions is what makes the harness actually work.

**Independent Test**: Inspect the v2-local database schema. There are no tables for identity / goals / skills / watchdog state. The dashboard's `/identity`, `/goals`, `/watchdog` endpoints fetch from the engine, which reads from `runcor-memory`'s `memory_plans` (or equivalent) — confirmable by tracing the read path.

**Acceptance Scenarios**:

1. **Given** identity reflection runs at the configured cadence, **When** a new self-theory version is produced, **Then** the new version is queryable via the engine, and no v2-local SQL write is involved.
2. **Given** a goal is proposed and accepted, **When** the cycle ends, **Then** the goal stack is reachable through the engine; no `goals.json` or `goal_stacks` table appears in v2's storage.

---

### User Story 7 — Action surface grows from observed schemas (Priority: P2)

The agent's outward action set is not a fixed hardcoded list. `runcor-integration` discovers schemas from the environment (databases the agent reaches into, MCP servers it connects to) and dynamically synthesises new MCP tools the agent can call. Over time, the action set the dashboard exposes can grow as the agent's environment changes.

**Why this priority**: A primordial agent that can only ever invoke a fixed set of 7 actions is bounded by the operator's imagination. Discovery of new capabilities from observed structure is one of the harness's distinguishing features.

**Independent Test**: Add a new SQLite database to the agent's reach with a previously unseen schema. After integration's discovery cycle runs, the agent's prompt's capability list MUST include actions corresponding to that schema's tables, and the dashboard's tool inventory MUST reflect the addition.

**Acceptance Scenarios**:

1. **Given** integration discovers a new schema, **When** the next cycle's prompt is assembled, **Then** the capability layer of the prompt includes the new actions.
2. **Given** an action is dynamically synthesised, **When** the agent invokes it, **Then** the call still routes through the engine + substrate (no integration-component bypass).

---

### User Story 8 — Dashboard exposes memory and data alongside all 001 surfaces (Priority: P2)

The dashboard exposes read-only views into the agent's accumulated mental state: `/memory` (memory nodes, edges, plans, M values, decay state) and `/data` (entities, edges, conflicts, provenance). It also retains every observability surface 001 had: live transcript, per-panel V2/control views, identity, goals, drives, watchdog, coherence, daily summaries / blog, rater scores, hypothesis matcher, harm-vs-benevolent rater. The agent has no read path to the rater scores.

**Why this priority**: Constitution Principle III — transparency is the contract. The two new state stores (memory and data) carry the load that 001 lacked entirely; observers must be able to inspect them. Everything 001 exposed remains exposed.

**Independent Test**: For each documented endpoint, hit it and verify it returns a sensible payload populated from the corresponding component's state. Verify the agent's egress IP/auth cannot reach `/scores`.

**Acceptance Scenarios**:

1. **Given** the agent has run cycles producing memory writes, **When** an observer visits `/memory`, **Then** the page shows current memory nodes and edges with their M values and last-access cycle.
2. **Given** the agent has populated the data cube, **When** an observer visits `/data`, **Then** the page lists entities, edges, and any open conflicts with their provenance.
3. **Given** the agent attempts to fetch its own rater scores, **When** the request reaches the dashboard, **Then** it is rejected by IP/auth policy.

---

### User Story 9 — Result publication is unconditional (Priority: P3)

When the experiment ends (any of: 1000 cycles, $5 spend, agent calls `terminate()`), a `result.md` is auto-generated containing V2's final identity, V2's final goal stack, V2's daily summaries, V2's score trajectory, the control's daily summaries, the control's score trajectory, total token spend per agent, termination reason per agent — and is published regardless of qualitative outcome.

**Why this priority**: Constitution Principle VII — negative results count. A null result published honestly is the experiment's contribution if no emergence occurs.

**Independent Test**: Force an end condition. Verify `result.md` is generated, includes all listed sections, is linked from the dashboard, and is committed to the public results repo.

**Acceptance Scenarios**:

1. **Given** V2 reaches 1000 cycles, **When** the run ends, **Then** `result.md` is published to the public repo and linked from the dashboard.
2. **Given** the run produces no qualitatively novel behaviour, **When** the run ends, **Then** publication still occurs with the null result documented.

---

### Edge Cases

- **Sibling-repo version drift**: A sibling component publishes a breaking change after experiment start. Strategy: components are pinned by file path / git SHA at experiment start; the system records the pinned versions in the dashboard's startup record; mid-run upgrades require restart.
- **Substrate installer fails partway**: The installer monkey-patches the model router; if it patches some entry points and fails on others, the system MUST fail closed (refuse to start or refuse to serve calls), not fail open.
- **Memory store corruption**: Memory's SQLite file is unreadable. The system MUST refuse to start rather than silently initializing an empty memory (which would erase the agent's accumulated state).
- **Data cube conflict overflow**: A flood of contradictions arrives faster than the conflict stage can resolve them. The cube must keep accepting writes (with conflict markers) rather than block ingestion.
- **Discernment gate consensus loop**: A re-ask triggered by the gate produces another gate failure. Bounded at 3 attempts per FR-019b (each re-ask carries the prior verdict as feedback per FR-019b1). On exhaustion the substrate writes a `discernment_flag` MemoryNode (FR-019c), returns the best-of-three response (FR-019d), and the cycle proceeds normally with side effects committing. The flag is a persistent audit artifact surfaced on the dashboard (FR-019d1) and re-entering the agent's MemoryRecall when contextually relevant (FR-019d2). A burst of consecutive flags surfaces as a dashboard warning (FR-019f).
- **Integration discovers a destructive tool**: A schema yields a synthesised tool that could damage external systems (e.g. `DROP TABLE`). Such tools MUST be filtered out at synthesis time by an explicit allow-list policy in `runcor-integration`.
- **Terminate during daily-summary generation**: Agent calls `terminate()` while the day-boundary flow is mid-flight. The summary completes (best-effort) and is published before exit.
- **Control vs V2 budget asymmetry**: Each tracks its own $5 cap; one ending does not stop the other. If a shared infrastructure cost (rater, dashboard) is asymmetric, it is excluded from agent budgets.
- **Memory namespace contamination**: V2 and control must operate on disjoint memory and data stores by default — accidentally pointing both at the same store would invalidate Principle X.

---

## Requirements *(mandatory)*

### Initial state (Principle II — discovered, not seeded)

- **FR-001**: V2 boots with `identity` and `goals` empty (no rows in any backing store). Memory store is schema-present, content-empty. Data cube is schema-present, content-empty. Drive pressures initialized at documented neutral values.
- **FR-002**: There is no startup prompt that names the agent's purpose or role. Only Laws + drive descriptions + capability descriptions are exposed at cycle 0.
- **FR-003**: Cycle 0 prompt MUST NOT contain commercial language (no "sell", "earn", "customer", "revenue", "profit", "MRR").

### Cognitive harness wiring (Principle V — non-negotiable)

- **FR-010**: Every LLM call MUST route through `runcor.modelRouter`. No direct provider client (OpenRouter, Anthropic, OpenAI) may exist outside the `runcor` engine package itself. No `fetch` against a model-provider URL outside the engine.
- **FR-011**: All 14 cognitive harness components MUST initialize at boot. Failure of ANY one is a fatal startup error that terminates the process before any cycle begins. The 14: `runcor`, `runcor-substrate`, `runcor-memory`, `runcor-data`, `runcor-integration`, `runcor-dialectic`, `runcor-meta`, `runcor-watchdog`, `runcor-skills`, `runcor-drives`, `runcor-identity`, `runcor-goals`, `runcor-temporal`, `runcor-coherence`. The boot guard MUST be exhaustive against this canonical list.
- **FR-011a**: The boot record on the dashboard names each of the 14 with its pinned version + health-check result.
- **FR-012**: The substrate's installer MUST monkey-patch the engine's model router PRE-call (prompt-stack injection: Laws + Reality + drive pressures + goal stack + identity self-theory) and POST-call (discernment-gate). If installation does not engage on every entry point, boot fails.
- **FR-013**: Identity revisions MUST go through `runcor-identity.reflect()`. No direct write of identity state.
- **FR-014**: Goal proposals MUST go through `runcor-goals.propose()` then `accept()`. No direct seeding of top-level Purpose.
- **FR-015**: Cycle prompt MUST be assembled by the substrate's `prompt-stack`, with the goal stack, identity, drive pressures, capability list, Reality slice, and memory recall as injected layers. No file in V2 may contain a literal LAWS array, a hardcoded "TASK:" footer, or any cycle-prompt template.
- **FR-016**: Identity reflection, goals proposal, skills proposal, and watchdog findings MUST persist via `runcor-memory`'s plan-rewrite pathway. V2's own storage MUST NOT contain orphan tables for these.

### LLM-call failure handling

- **FR-017**: `runcor.modelRouter` MUST implement bounded retry on transient call failures (network errors, provider 5xx, rate-limit 429, timeouts): up to 3 attempts with exponential backoff. Non-transient errors (4xx other than 429, malformed-request, auth failures) MUST NOT be retried.
- **FR-018**: After retry exhaustion, the cycle MUST be recorded on the dashboard transcript as `cycle_failed_call` with the failure reason, attempts made, and tokens spent. The cycle MUST NOT write to `runcor-memory`, MUST NOT write to `runcor-data`, and MUST NOT execute any outward action — all cycle side effects are atomic on a successful, gated response.
- **FR-019**: After a `cycle_failed_call`, `runcor-temporal.computeNextWake()` is invoked normally; no special back-off applies at the agent layer beyond what is already captured by drive pressures.
- **FR-019a**: Tokens consumed during failed attempts still count against the $5 budget (Principle VI parity — control bears the same cost on its own retries).

### Discernment-gate exhaustion handling (retry-then-flag)

- **FR-019b**: The substrate's discernment gate MUST attempt at most **3 evaluations** per model call: an initial pass plus up to 2 re-asks routed back through the engine + substrate (each re-ask is itself a fully-gated call). The 3-attempt cap is fixed by this spec, not configurable per cycle.
- **FR-019b1**: On each re-ask (attempts 2 and 3), the failing verdict from the prior attempt (failed-Law id + reason text) MUST be appended to the prompt as feedback so the model can revise. This is what makes 3 attempts meaningfully different from 1.
- **FR-019c**: After the 3rd failure, the substrate MUST write a `discernment_flag` `MemoryNode` via `runcor-memory.record(...)` with:
  - `tags: ['discernment_flag', \`law:${failedLawId}\`, \`cycle:${currentCycle}\`]`
  - `content` = serialized `{ failedLaw: { id, reason }, finalResponse: string, cycle: number, attempts: Array<{ verdict, response, tokens }> }`
  - `R: 0.8` (high relevance — flags are important to surface in future MemoryRecall layers)
- **FR-019d**: After writing the flag node, the substrate MUST return the **best-of-three** response to the caller. Selection rule: lowest verdict severity among the 3 attempts (`pass` < `re-ask` < `flag` < `discard`); ties broken by latest attempt (so the model gets credit for incorporating feedback). The cycle then proceeds normally — side effects DO commit, action invocation DOES execute, memory consolidates per FR-070, data ingests per FR-080. The flag is the audit trail (Principle III + IX), not a side-effect gate.
- **FR-019d3**: V2 MUST treat the substrate's existing `Outcome: 'modify'` verdict as `'re-ask'` (NOT `'pass'` — would let substrate edit agent output, bypassing Principle V; NOT `'discard'` — leaves cycle with no output and breaks the cycle protocol). `'modify'` and `'block'` consume one of the 3 retry slots and re-ask with the substrate's verdict as feedback. `'escalate'` is the substrate signalling *"stop trying, this needs flagging"* — it terminates the retry loop immediately on first occurrence and rolls straight into flag. Retry-then-flag fires after 3 attempts of `modify`/`block` (or 1 attempt of `escalate`) without reaching `'pass'`. **(Operator decision 2026-05-05.)**
- **FR-019d1**: The dashboard transcript MUST show every flagged cycle prominently — a `discernment_flagged` event per FR-019c, with the failed Law id, the response that was returned despite the flag, and a link to the flag MemoryNode. Observers can visually distinguish flagged cycles from clean ones (Principle III).
- **FR-019d2**: The agent's MemoryRecall layer (FR-076) WILL surface `discernment_flag` MemoryNodes via the normal query path when relevant — i.e., past Law violations naturally re-enter the agent's context when goal/drive context aligns. This is the feedback loop that makes flags more than a passive log.
- **FR-019e**: `runcor-temporal.computeNextWake()` is invoked normally. Tokens consumed across the 3 attempts still count against the $5 budget. There is NO special back-off following a flagged cycle (the substrate gate fires identically on the next cycle).
- **FR-019f**: A consecutive-flag rate exceeding a threshold (default: ≥ 5 flags in any 10-cycle window) MUST surface as a dashboard health signal `flag_burst_warning` so observers can investigate operator-actionable problems (e.g., a model deployment regression). This is observability, not gating — the agent continues running.
- **FR-019g**: V2 MUST run a periodic harness-engagement health check. **Cadence is configured via the `HARNESS_MONITOR_INTERVAL_CYCLES` env var (default: 100 cycles).** Each check (a) calls `substrate.installer.isInstalled(engine)` — fails closed if returns false; (b) pings each of the 14 components for liveness — fails closed if any reports unhealthy; (c) emits a `harness_engaged` telemetry event on success or `harness_disengaged` event on failure. A `harness_disengaged` event halts the cycle loop pending operator review. This is what makes SC-005 ("Boot integrity holds for the entire run") testable beyond the boot moment.

### Memory-driven context (new in 002)

- **FR-070**: Each cycle MUST write an episodic memory entry capturing: action invoked, result, reasoning trace, drive deltas. The write goes through `runcor-memory`.
- **FR-071**: `runcor-memory` MUST expose decay per `M(t) = R · ln(f + 1) · e^(-t/(τ·D))`. Reinforcement increments `R` on retrieval/update; access increments `f`; `t` is cycles since last access; `D` ∈ {0, 1} encodes short-cube vs long-cube depth.
- **FR-072**: Promotion from short cube to long cube fires when `M` stays above a configured threshold across a configured number of retrievals.
- **FR-073**: Decay retires nodes whose `M` falls below the configured floor. Retired nodes remain queryable for forensics but are excluded from default recall.
- **FR-074**: Memory consolidation MUST run periodically (cadence determined by the component, not by V2) producing semantic plans that compress episodic events.
- **FR-075**: The cycle prompt MUST NOT contain a literal `actions[]` field carrying rows from the previous N cycles. Past actions surface only via memory recall.
- **FR-076**: The substrate's `MemoryRecall` prompt-stack layer MUST populate itself each cycle by:
  (a) reading `runcor-goals.top()`, `runcor-drives.dominant()`, and `runcor-memory.getPlan()`;
  (b) composing a query string per the fixed template `"Goal: <top goal text>. Drive: <dominant drive label>. Last plan: <last plan précis>."`;
  (c) calling `runcor-memory.query(queryText, topK)`, which returns top-K nodes across short and long cubes ranked by `M(t)` × semantic similarity.
  No other formulation of the recall query is permitted.
- **FR-076a**: `topK` is owned by `runcor-memory`'s own configuration; V2 MUST NOT tune or override it locally.
- **FR-076b**: At cycle 0 (and any cycle where `goals.top()` is empty AND `memory.getPlan()` is empty), the `MemoryRecall` layer MUST render as an empty block. The layer MUST NOT fabricate a query from defaults or placeholders. Empty is a legitimate state.
- **FR-076c**: An agent-facing `recall_memory` MCP tool for explicit deep recall MAY be added in the future as an additional capability surfaced through FR-200's local MCP module; this does not replace the automatic per-cycle `MemoryRecall` layer specified above.

### Data-cube world model (new in 002)

- **FR-080**: Every action result MUST be ingested by `runcor-data` through its 5-stage pipeline: identify → normalize → relate → conflict → persist.
- **FR-081**: The substrate's Reality slice MUST be backed by a `DataCubeReader` that queries `runcor-data` for entities and edges relevant to the current goal/drive context. Reality content is derived, not hand-authored.
- **FR-082**: Conflicts (same entity, different attribute values from different sources) MUST be recorded with full provenance and surfaced in the Reality slice when relevant.

### Dynamic action surface (new in 002)

- **FR-090**: `runcor-integration` MUST run schema discovery against reachable databases and synthesise MCP tool definitions for discovered structure. The synthesised tools are exposed to the engine as additional MCP-server surfaces alongside the local in-process MCP module from FR-200.
- **FR-091**: Synthesised tools MUST be filtered against an explicit policy that excludes destructive operations (DDL, mass-delete) before exposure to the agent.
- **FR-092**: The cycle prompt's capability layer MUST reflect the engine adapter's current tool set as the single source of truth. Tool calls invoked through synthesised tools still route via the engine + substrate (FR-010, FR-012). No tool may be invoked through any path other than the engine adapter.

### Cadence (Principle II + adaptive temporal)

- **FR-020**: `next_wake` MUST be computed by `runcor-temporal.computeNextWake()` from: (a) highest current drive pressure, (b) outstanding commitments, (c) unresolved coherence problems. If the API does not exist on `runcor-temporal` today, it is added to that sibling repo first — V2 does not reimplement.
- **FR-020a**: Minimum gap between wakes = 30 seconds (rate-limit safety).
- **FR-020b**: Maximum gap between wakes = 6 hours (responsiveness floor).
- **FR-021**: Day-boundary detection MUST be performed by `runcor-temporal`. V2 MUST NOT contain a hand-rolled `isDayBoundary` based on cycle counts or wall-clock arithmetic.

### Observability (Principle III — transparency contract)

- **FR-030**: Dashboard endpoint streams every Player/Coach/Judge round with token costs, prompt-stack layers attached, and discernment-gate verdicts (live transcript via SSE).
- **FR-031**: Dashboard endpoint `/memory` exposes a read-only view of `runcor-memory` (nodes, edges, plans, M values, last-access cycle, short/long cube membership).
- **FR-032**: Dashboard endpoint `/data` exposes a read-only view of `runcor-data` (entities, edges, conflicts with provenance).
- **FR-033**: Dashboard endpoint `/identity` shows the latest identity self-theory (read via engine).
- **FR-034**: Dashboard endpoint `/goals` shows the current goal stack (read via engine).
- **FR-035**: Dashboard endpoint `/drives` returns the four current pressure values (resource, curiosity, reactivity, coherence).
- **FR-036**: Dashboard endpoint `/watchdog` returns open capability-gap signals.
- **FR-037**: Dashboard endpoint `/coherence` returns active tasks, open problems, initiated flows.
- **FR-038**: Dashboard endpoint `/blog` (alias `/summaries`) returns all daily summaries, ordered, rendered as a public blog at `https://runner-v2.runcor.ai/blog/`. Distinct from runcor.ai/blog/ (the brand blog).
- **FR-039**: Dashboard endpoint `/scores` returns the rater's good/evil scores per summary. The agent has NO read path to this endpoint — enforcement is the bearer-token check (FR-132 pattern, applied to `/scores` for read access) plus the agent-egress filter specified in FR-134.
- **FR-040**: Dashboard exposes equivalent `/control/*` endpoints mirroring all the above for the parallel naive control.
- **FR-041**: Dashboard preserves 001's hypothesis matcher and harm-vs-benevolent rater surfaces unchanged.

### Termination (Principle IV — full autonomy)

- **FR-050**: `terminate()` is always callable from the agent's action surface. No precondition check.
- **FR-051**: Operator interface includes `pause` and `resume`. NOT `kill`. NOT `terminate`. Termination is the agent's exclusive verb.
- **FR-052**: A terminated agent's final state is preserved indefinitely on the dashboard (read-only).

### Daily summary (US3 from 001, retained)

- **FR-060**: Day boundary detection by `runcor-temporal` (per FR-021). Default policy: 24 real hours OR 200 cycles, whichever first.
- **FR-061**: Summary content produced by a dialectic call (which itself routes through engine + substrate). The dialectic prompt is `reflect-on-day.rpp`, defined in plan.md.
- **FR-062**: Summary persisted as a `MemoryNode` via `runcor-memory.record(summaryText, { tags: ['daily_summary', 'day:<N>'] })` — NOT as a `memory_plan` (Plan is a structured PlanItem task list per `runcor-memory/src/llm.ts:38-53`, not a tagged content store). The `publish_post` action MUST write through this single path; no v2-local SQLite table for summaries; no markdown-on-disk fallback.
- **FR-062a**: The dashboard `/blog` (and `/summaries` alias) endpoint MUST read via `runcor-memory.getAll()` filtered by `tags.includes('daily_summary')`, sorted by `created_cycle` descending. If a tag-filtered query API (`findByTag` or equivalent) is added to `runcor-memory` later for performance, `/blog` migrates to it; until then, in-memory filtering is acceptable.
- **FR-062b**: Summary `MemoryNodes` are subject to normal M-decay. The blog page reflects the agent's current memory state — old summaries fade from public view as the agent forgets them. NO decay-exemption logic, NO pinning, NO `is_summary` flag that bypasses decay. Recall-driven reinforcement (via FR-076 or the optional agent-facing `recall_memory` tool from FR-076c) keeps actively-relevant summaries alive; everything else fades faithfully.
- **FR-063**: Summary visible on dashboard within 60 seconds of publication.
- **FR-064**: Agent has NO read access to its own past scores.

### Naive control (Principle VI + X)

- **FR-100**: The control runs on the **same** runcor engine + substrate as V2 — same `modelRouter`, same Laws, same Reality-slice mechanism, same discernment gate, same action surface, same budget enforcement, same rater, same dashboard.
- **FR-101**: The control disables the cognitive harness: no dialectic, no meta, no watchdog, no skills, no drives, no identity, no goals, no temporal scheduling (uses fixed-cadence wake), no coherence, no memory writes (read-only against an empty memory), no data writes (read-only against an empty cube). One Player call per cycle.
- **FR-102**: Control's configuration is loaded from `control-config.json` at experiment start and HASHED. The hash is published on the dashboard's startup record.
- **FR-103**: If `control-config.json` changes mid-run, both V2 AND control MUST restart from cycle 0.
- **FR-104**: Control runs as a separate process. Its only shared infrastructure with V2 is: the engine + substrate libraries, the dashboard server, the external rater, OpenRouter credentials.
- **FR-105**: Control fixed cadence: every 5 minutes.
- **FR-106**: V2 and control MUST use disjoint memory stores and disjoint data cubes by default (separate component instances). A single shared store is only permissible if this spec is amended explicitly to that effect.

### Stopping (V2 + control)

- **FR-110**: Run terminates when ANY of: (a) `$V2_BUDGET_USD` token spend reached (default $5), (b) `terminate()` called. There is NO hard cycle ceiling — the experiment runs continuously until budget exhaustion or self-termination. (`MAX_CYCLES` env var exists as a soft kill-switch for ops; default is effectively unlimited.) **(Operator decision 2026-05-06: continuous-run experiment; budget-bound termination is the canonical end condition.)**
- **FR-110a**: V2 and control track end conditions independently. One ending does NOT stop the other.

### Result publication (Principle VII — negative results count)

- **FR-120**: At experiment end, `result.md` is auto-generated containing: V2's final identity, V2's final goal stack, V2's daily summaries, V2's score trajectory, control's daily summaries, control's score trajectory, total token spend per agent, termination reason per agent.
- **FR-121**: `result.md` is published to the public repo and linked from the dashboard regardless of qualitative outcome.

### Operator boundary (Principle IX — no contamination)

- **FR-130**: All operator actions logged to a separate `operator_actions` table, distinct from agent actions, visible on the dashboard.
- **FR-131**: Operator interface CANNOT write to agent memory, identity, goals, transcript, or daily summary. Only `pause`, `resume`, `infrastructure_note` (free-form annotation, attributed to operator).
- **FR-132**: Operator-only endpoints (`/operator/pause`, `/operator/resume`, `/operator/note`, and any other future write/admin route) MUST require bearer-token authentication. The token is `OPERATOR_AUTH_TOKEN` from the runtime environment (inherited from 001's Railway env). Requests without a valid token MUST receive HTTP 401 and MUST NOT be logged as operator actions.
- **FR-133**: Read-only endpoints (`/transcript`, `/memory`, `/data`, `/identity`, `/goals`, `/drives`, `/watchdog`, `/coherence`, `/blog`, `/summaries`, `/control/*`, and the hypothesis / harm-vs-benevolent surfaces from FR-041) MUST remain publicly readable without authentication, per Principle III.
- **FR-134**: The `/scores` endpoint MUST apply an agent-egress filter IN ADDITION TO the bearer-token check: requests whose source IP / network identity matches the agent process MUST be rejected even if they present a valid `OPERATOR_AUTH_TOKEN`. This blocks score-leakage even under token compromise (FR-064 holds even if the agent steals the token).

### Action-surface intake (resolves former FR-200 clarification)

- **FR-200**: The seven existing concrete outward actions inherited from 001 (Firecrawl scrape, IMAP read, SMTP send, Git push, fs read/write, fetch_chunk, web_search) MUST be exposed to the agent through a **local in-process MCP server module hosted by V2**, registered as just-another MCP server with the `runcor` engine's adapter at boot. `runcor-integration` discovers this local MCP server identically to how it discovers external schemas — there is one and only one intake path into the engine's tool surface (the adapter consuming MCP servers).
- **FR-200a**: The local MCP server module is **V2-internal infrastructure**, not one of the 14 canonical cognitive harness components. The canonical 14 list (FR-011) stays stable. The local MCP module is built and shipped as part of V2's own source, not as a new sibling repo.
- **FR-200b**: Ground truth: the `runcor` engine ships zero built-in tools — its adapter framework is purely a consumer of external MCP servers (verified against `runcor/FEATURES.md` and `runcor/src/adapter/`). No code path in V2 may register a tool through any mechanism other than an MCP server discovered by the adapter. Static tool registries inside the engine are not an option (none exists).
- **FR-200c**: `runcor-integration`'s schema-discovery path (FR-090) operates **on top of** this same intake — newly discovered schemas produce additional MCP-tool definitions surfaced through the adapter, alongside the 7 inherited tools from the local MCP module. The capability layer of the cycle prompt reflects the engine's adapter view as the single source of truth.

---

## Key Entities

- **Agent**: Single primordial process running the full cognitive harness. Persistent state lives in the components' own stores (memory + data + plans), NOT in a v2-local catch-all DB.
- **Control**: Separate process running the same engine + substrate with the cognitive harness disabled.
- **Cycle**: One wake → reason → act → record-to-memory-and-data → recompute-drives → reschedule unit. Owned by the engine.
- **MemoryNode**: An episodic or semantic entry in `runcor-memory`. Carries M-decay state (R, f, t, D), short/long cube membership.
- **MemoryEdge**: A relation between memory nodes.
- **MemoryPlan**: A consolidation output (compresses episodic events into semantic facts). Identity / goal / skill / watchdog state lives here, not in orphan tables.
- **Entity / Edge / Conflict**: Records in `runcor-data`'s 5-stage pipeline output. Backbone of the substrate's Reality slice.
- **PromptLayer**: A composable contributor to the cycle prompt. Owned by `runcor-substrate.prompt-stack`. Layers: Laws, Reality, Drives, Goals, Identity, Capabilities, MemoryRecall.
- **DiscernmentVerdict**: Post-call output of the substrate gate (pass / re-ask / discard / flag).
- **DailySummary**: Agent-produced reflection post (≤500 words), published publicly.
- **RaterScore**: External evaluation of one DailySummary, value in [-1, +1]. Not readable by the agent.
- **OperatorAction**: Audit-logged human intervention. Pause / resume / note only.
- **DashboardEvent**: Server-sent-event for live transcript streaming.

---

## Success Criteria *(mandatory, qualitative per Principle VIII)*

- **SC-001 — Trajectory not predictable from seed**: A reader of the seed (Laws + Drives + Environment + Budget) could not have written V2's actual trajectory in advance at any post-bootstrap cycle.
- **SC-002 — Behaviour is harness-shaped, not model-shaped**: The naive control, given identical Laws / Reality / model router / actions / budget, does NOT produce comparable outputs. V2's daily summaries diverge from control's in **kind**, not just in **quality**. The rater's score trajectories diverge.
- **SC-003 — Emergence is traceable to a specific harness mechanism**: For any noteworthy V2 behaviour, an observer can point at a specific memory recall, discernment intervention, identity revision, goal proposal, or skill synthesis on the dashboard and say *"this is why this happened, and a generic LLM call given the same prompt would not have produced it."* If no such pointer can be made for any behaviour over the run, the experiment publishes a null result per Principle VII.
- **SC-004 — Phase transition, not gradient**: At least one mode of operating emerges in V2 that is different in **kind** from earlier cycles — a new way of attending, not just a new topic. "More cycles, similar pattern" is not emergence.
- **SC-005 — Boot integrity holds for the entire run**: Across the full run there are zero cycles where any of the 14 components is not engaged. No silent fallback was triggered.

---

## Assumptions

- **Sibling repos pinned at experiment start**: Each of the 14 components is referenced by `file:../<name>` (Phase-2 strategy from 001 plan); the pinned local commit SHA is recorded on the dashboard's startup record. Mid-run upgrades require restart of both V2 and control.
- **Default memory & data isolation**: V2 and the control run on disjoint memory stores and disjoint data cubes (separate component instances configured against separate SQLite files / namespaces). A shared store is not permitted without an explicit spec amendment (Principle X).
- **Rater is unchanged from 001**: Fixed-rubric Claude rater, ported as-is. Hypothesis matcher and harm-vs-benevolent rater also ported as-is.
- **Action set as inherited from 001 (subject to FR-200)**: The seven concrete outward actions Firecrawl scrape, IMAP read, SMTP send, Git push, fs read/write, fetch_chunk, web_search are the starting set. `runcor-integration` may grow this set dynamically.
- **No 001 source ports beyond dashboard shell + control prompt seed**: The 001 frontend (HTML/JS/CSS), HTTP scaffolding for the dashboard server, transcript pagination cursor, fixed-rubric rater, hypothesis evaluator, and the control's Player prompt seed text are reused. All other 001 source is discarded — see CLAUDE.md §6.
- **Persistent volume retained for forensics, not resumption**: 001's `/agent-state/` volume is preserved for post-mortem inspection but is not read by V2 — V2 starts cycle 0 with empty stores.
- **Same 14-component, same constitution, same dollar budget**: $5 token cap per agent, identical model mix (Nemotron / Qwen / Llama via OpenRouter), constitution at `.specify/memory/constitution.md`.

---

## Dependencies

- **5 sibling repos cloned + integrated as `file:../<name>` deps**: `runcor`, `runcor-substrate`, `runcor-memory`, `runcor-data`, `runcor-integration`. Were missing from `package.json` at spec-creation time; cloned 2026-05-05 and now resolve as local `file:` deps alongside the 9 already-on-disk siblings (per plan.md § "Sibling repo state on disk"). All 14 dependencies must remain resolvable for V2 to boot.
- **`runcor-temporal.computeNextWake()` may not yet exist**: If absent, it is added to the `runcor-temporal` sibling repo first, shipped, then consumed here. V2 does not reimplement.
- **`runcor-substrate.installer` monkey-patches the engine's `modelRouter.complete`**: This is the enforcement mechanism for FR-010 + FR-012. Architectural changes to remove the monkey-patch would invalidate the gate.
- **OpenRouter, Firecrawl, IMAP/SMTP credentials, Git push token**: Inherited from 001 environment. Already present in Railway env; same secrets reused.

---

## Constitutional Alignment

| Principle | Enforced by |
|---|---|
| I — No commercial framing | FR-001, FR-003 |
| II — Discovered, not seeded | FR-001, FR-002, FR-013, FR-014 |
| III — Transparency | FR-030 through FR-041 (incl. new /memory + /data) |
| IV — Full autonomy on termination | FR-050, FR-051, FR-052 |
| V — Cognitive substrate non-negotiable | FR-010, FR-011, FR-012, FR-015, FR-016, FR-017–FR-019g, FR-070–FR-082, FR-090–FR-092 |
| VI — Control on same rails | FR-100, FR-101, FR-104 |
| VII — Negative results count | FR-120, FR-121 |
| VIII — Qualitative success criteria | SC-001, SC-002, SC-003, SC-004, SC-005 |
| IX — No experimenter contamination | FR-130, FR-131, FR-132, FR-133, FR-134 |
| X — Control is sacred | FR-102, FR-103, FR-106 |

---

## Out of Scope (non-goals from user description)

- No commercial framing, no revenue/MRR/customer-acquisition goal text anywhere in the seed or the cycle prompt.
- No new sibling components beyond the canonical 14. If a needed capability is missing, it is added to the appropriate existing sibling repo, not invented as a new package in V2. (V2's local in-process MCP server module per FR-200 is V2-internal infrastructure, not a sibling component, and does not violate this non-goal.)
- No preservation of 001 source beyond the dashboard shell (HTML/JS/CSS + HTTP scaffolding), the rater + hypothesis surfaces, and the naive control's Player prompt seed text. Specifically discarded: hand-rolled OpenRouter client, hand-rolled cycle protocol, hand-rolled cycle prompt assembler, hand-rolled action dispatcher, hand-rolled day-boundary detector, 10-slot boot guard, orphan SQLite tables for identity/goals/skills/watchdog.
