# Data Model: V2 Faithful Rebuild

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**Plan**: [./plan.md](./plan.md) | **Spec**: [./spec.md](./spec.md) | **Research**: [./research.md](./research.md)

This document catalogues every entity V2 reads or writes, its fields, its provenance, and (where applicable) its state transitions and validation rules. Storage choices are pinned. Each entity links back to the FR(s) it satisfies.

Three storage tiers:
1. **Sibling-component-owned** (memory.db, data.db) — V2 only reads/writes through component APIs, never SQL directly.
2. **V2-owned but minimal** (operator audit log, control-config hash, run metadata, transcript SSE buffer) — these are V2 concerns, not agent state.
3. **In-memory only** (DiscernmentVerdict, current LayerContext) — built per cycle, not persisted as such; the *outcome* is persisted via the appropriate component.

---

## Entity catalogue

### MemoryNode (component-owned by `runcor-memory`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID assigned at creation |
| `content` | string | Free-form text — episodic event description, daily summary, identity self-theory text, etc. |
| `embedding` | number[] | OpenAI-style embedding vector (computed at record time) |
| `R` | number 0..1 | Relevance — defaults 0.5, override via `RecordOptions.R` |
| `f` | number ≥0 | Access frequency — incremented on `query()` retrieval |
| `t` | number ≥0 | Cycles since last access |
| `D` | number 0..1 | Density / uniqueness factor |
| `M` | number ≥0 | Computed: `R · ln(f + 1) · e^(−t / (τ·D))` (FR-071) |
| `cube` | `'short'` \| `'long'` | Promotion gate at `M ≥ 1.5` (`runcor-memory/src/types.ts:47`); fallback to `'short'` after creation |
| `createdAt` | number | Wallclock ms |
| `lastAccessed` | number | Wallclock ms |
| `created_cycle` | number | Cycle counter at creation — used by `/blog` for descending sort (FR-062a) |
| `source` | string \| null | Optional provenance — typically the cycle action that produced this node |
| `tags` | string[] | E.g. `['daily_summary', 'day:7']`, `['identity_snapshot', 'version:3']`, `['goal_proposal', 'status:accepted']` (R8) |

**Validation rules**:
- `R, D ∈ [0, 1]`; `f ≥ 0`; `t ≥ 0`. Component-enforced.
- `tags` MUST follow the V2 conventional schemes (R8); `runcor-memory` itself doesn't validate tag content.
- `content` non-empty.

**State transitions**:
- *created* (in short cube) → *promoted* (M ≥ 1.5 sustained → moved to long cube; t reset to 0; content compressed via LLM précis; embedding recomputed; M recalculated using `τ · durability`).
- *active* → *retired* (M < 0.05 → forgotten from default recall; row remains for forensics).

**FR mapping**: FR-070 (per-cycle episodic write), FR-071 (decay), FR-072 (promotion), FR-073 (decay floor), FR-076 (recall query), FR-062 (daily summaries as MemoryNodes).

---

### MemoryEdge (component-owned by `runcor-memory`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `fromNodeId` | string | |
| `toNodeId` | string | |
| `relation` | string | `'precedes'`, `'contradicts'`, `'consolidates_to'`, `'evidences'` |
| `weight` | number | Optional strength scalar; defaults 1.0 |

**FR mapping**: FR-022 (now FR-031 — `/memory` exposes edges), FR-074 (consolidation produces `consolidates_to` edges).

---

### Plan / PlanItem (component-owned by `runcor-memory`, ground-truth at `runcor-memory/src/llm.ts:38-53`)

```ts
interface Plan {
  cycle: number;          // cycle when this plan was rewritten
  items: PlanItem[];
  strategy: string;       // free-form description of the rewrite strategy
  changes: string[];      // human-readable change log vs prior plan
}

interface PlanItem {
  id: string;
  text: string;
  status: 'pending' | 'active' | 'done' | 'blocked';
  priority: number;       // 0..n
  category?: string;      // e.g. 'goal:purpose', 'goal:objective', 'goal:initiative', 'coherence_task'
  added_cycle: number;
  completed_cycle: number | null;
}
```

**Used by V2 for** (per R8):
- Goal stack (P/O/I) — each `PlanItem.category` distinguishes purpose/objective/initiative.
- Coherence active task list — `category = 'coherence_task'`.
- Identity self-theory is NOT a Plan (it's a `MemoryNode` — Plan ≠ MemoryNode primitive distinction settled in clarifications).

**State transitions**:
- *pending* → *active* (when chosen for execution)
- *active* → *done* (with `completed_cycle` set)
- *active* → *blocked* (with reason in `changes[]`)
- *blocked* → *active* (when unblocked)

**FR mapping**: FR-016 (cognitive components persist via memory plan-rewrite pathway), FR-074.

---

### Entity (component-owned by `runcor-data`)

```ts
interface Entity {
  id: string;                            // canonical id post-normalization
  name: string;                          // display name; pre-normalization variants captured in attributes
  type: string;                          // 'person' | 'organization' | 'document' | 'event' | 'topic' | ...
  attributes: Record<string, AttributeValue>;
  provenance: ProvenanceRecord[];
  createdAtCycle: number;
  lastUpdatedCycle: number;
}

interface AttributeValue {
  value: unknown;
  source: string;                        // cycle id + action name that asserted this
  cycle: number;
}

interface ProvenanceRecord {
  cycle: number;
  action: string;
  rawSourceUri?: string;                 // URL or file path if applicable
}
```

**Validation rules**:
- `id` MUST be canonical post-normalize stage — entity dedup happens at normalization, not at write.
- `attributes` keys are typed per `type` (e.g. a `person` Entity has known attributes `email`, `org`, etc.); unknown attributes accepted and stored.

**FR mapping**: FR-080 (5-stage ingestion), FR-081 (Reality slice reads), FR-082 (conflict surfacing).

---

### Edge (component-owned by `runcor-data`)

```ts
interface Edge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relation: string;                      // 'works_at', 'attended', 'authored', 'mentioned_in', ...
  attributes?: Record<string, AttributeValue>;
  provenance: ProvenanceRecord[];
}
```

**FR mapping**: FR-080, FR-081.

---

### Conflict (component-owned by `runcor-data`)

```ts
interface Conflict {
  id: string;
  entityId: string;
  attribute: string;
  values: AttributeValue[];              // ≥2 contradictory values, each with provenance
  status: 'open' | 'resolved';
  resolutionRule?: 'most_recent' | 'majority' | 'manual' | null;
  resolvedAtCycle?: number;
  resolvedValue?: unknown;
}
```

**State transitions**:
- *open* (created when ingest's conflict stage detects contradiction) → *resolved* (when a resolution rule fires or operator marks manual).

**FR mapping**: FR-082, FR-032 (`/data` shows open conflicts).

---

### PromptLayer (in-memory only; defined by `runcor-substrate`)

```ts
interface PromptLayer {
  name: 'laws' | 'reality' | 'drives' | 'goals' | 'identity' | 'capabilities' | 'memory_recall';
  render(context: LayerContext): string | null;  // null = empty layer
}

interface LayerContext {
  cycle: number;
  agentRole: 'v2' | 'control';
  baseRequest: ModelRequest;             // the original call's prompt
  // Component snapshots — captured at cycle start
  drives: { resource: number; curiosity: number; reactivity: number; coherence: number };
  topGoal: PlanItem | null;
  identitySelfTheory: string | null;
  lastPlanPrécis: string | null;
  recalledNodes: MemoryNode[];           // result of memory.query(...)
  realitySlice: RealitySlice | null;     // from runcor-data.query(...)
  capabilityList: McpToolDefinition[];   // from engine adapter view
}
```

**Layer render order** (deterministic, owned by substrate):
1. `laws` — always non-empty (10 Laws from constitution)
2. `reality` — non-empty when data cube has relevant entities; empty otherwise
3. `drives` — always non-empty (renders the 4 pressures with brief labels)
4. `goals` — empty at cycle 0 (FR-001), non-empty once goals exist
5. `identity` — empty until first reflection completes (FR-001), non-empty thereafter
6. `capabilities` — always non-empty (at minimum the 7 inherited tools from FR-200)
7. `memory_recall` — empty at cycle 0 and any cycle where `goals.top()` AND `lastPlan` are both empty (FR-076b)

**FR mapping**: FR-015 (prompt-stack assembles), FR-076 (recall query construction), FR-076b (cycle-0 empty contract).

---

### DiscernmentVerdict (in-memory only; defined by `runcor-substrate`)

```ts
// Substrate's existing `Outcome` type (unchanged — kept for backwards compat with current substrate consumers per Operator Decision 2)
type Outcome = 'pass' | 'modify' | 'block' | 'escalate';

// V2's verdict shape — substrate PR adds 'flag' as a NEW additive variant
type DiscernmentVerdict =
  | { kind: 'pass' }
  | { kind: 're-ask'; reason: string; lawId: string }
  | { kind: 'flag'; reason: string; lawId: string; flagSeverity: 'low' | 'medium' | 'high' }
  | { kind: 'discard'; reason: string; lawId: string };  // reserved — not used in retry-then-flag (would inhibit side effects; not the chosen behavior)
```

**Severity ordering** (used for best-of-three selection in research.md §R4): `pass` < `re-ask` < `flag` < `discard`.

**Substrate vs V2 enum mapping** (per FR-019d3, operator decision 2026-05-05): V2's adapter consumes `Outcome` from substrate and maps to `DiscernmentVerdict.kind`:
- `pass` → `pass`
- `modify` → `re-ask` (NOT `pass`: accepting modified output bypasses Principle V — substrate would be editing agent output. NOT `discard`: leaves cycle with no output and breaks protocol. `re-ask` consumes a retry slot and folds modify into the existing retry-then-flag flow.)
- `block` → `re-ask` for attempts 1–2; on attempt 3 rolls into `flag` (consumes a retry slot)
- `escalate` → `flag` **immediately on first occurrence** (substrate signalling "stop trying, this needs flagging" — terminates the retry loop without consuming further attempts)

Retry-then-flag fires after 3 attempts of `modify`/`block` (or 1 attempt of `escalate`) without reaching `'pass'`. The substrate continues to emit the existing 4-variant `Outcome` for stability with current consumers; V2 simply maps it.

**Telemetry**: every verdict is emitted via substrate → V2 EventBus → dashboard transcript SSE. Persisted as a transcript line tagged with the verdict kind. Flag verdicts that exhaust to retry-then-flag ALSO write a `discernment_flag` MemoryNode (FR-019c) — that's separate persistence.

**FR mapping**: FR-019b–FR-019f (retry-then-flag handling), FR-030 (transcript shows gate verdicts).

---

### DiscernmentFlag (persisted as MemoryNode — new in retry-then-flag)

A `MemoryNode` with `tags = ['discernment_flag', 'law:<failedLawId>', 'cycle:<N>']`, `R = 0.8` (high relevance — flags should surface in future MemoryRecall layers when contextually relevant per FR-019d2).

**Content shape** (JSON-serialized into the MemoryNode's `content` field):
```ts
{
  failedLaw: { id: string, reason: string },     // the Law that failed on the 3rd attempt
  finalResponse: string,                          // the response on the 3rd attempt (whatever the model produced last)
  cycle: number,                                  // V2 cycle counter
  attempts: Array<{                               // full audit trail
    verdict: DiscernmentVerdict,
    response: string,
    tokens: number,
  }>,
  returnedResponse: string,                       // the best-of-three response (could differ from finalResponse if attempt 1 or 2 was less severe)
}
```

**Lifecycle**: subject to normal M-decay like any MemoryNode (FR-019d explicitly does NOT add decay-exemption — flags fade as the agent forgets them, just like every other memory). Recall-driven reinforcement keeps actively-relevant flags alive.

**FR mapping**: FR-019c (write contract), FR-019d (best-of-three return), FR-019d2 (re-entry via MemoryRecall).

---

### CycleRecord (V2-owned, in transcript SSE buffer + optional persistence)

```ts
interface CycleRecord {
  cycle: number;
  agentRole: 'v2' | 'control';
  startedAt: number;
  endedAt: number;
  status: 'completed' | 'completed_with_flag' | 'cycle_failed_call';
  modelCalls: number;                    // total attempts; ≥ 1, can reach 3 on flagged cycles
  totalTokens: number;                   // sum across all attempts
  totalCostUsd: number;
  actionInvoked?: { name: string; args: object; resultSummary: string } | null;
  memoryWrites: number;                  // 0 iff status = 'cycle_failed_call' (FR-018); ≥ 1 on completed/completed_with_flag
  dataIngestEvents: number;              // 0 iff status = 'cycle_failed_call'
  flag?: {                               // present iff status = 'completed_with_flag'
    flagNodeId: string,                  // the MemoryNode id of the persisted flag
    failedLawId: string,
    attemptsCount: 3,
  };
  failureReason?: string;                // present iff status = 'cycle_failed_call'
}
```

**Persisted to**: SSE buffer (transient, in-memory ring buffer of the most recent **200 `CycleRecord`s** by default; configurable via `CYCLE_RECORD_BUFFER_SIZE` env var). Past cycle records older than the buffer window are reconstructable from `runcor-memory` episodic entries (which carry the same metadata in their content); V2 does NOT maintain a separate `cycles` table.

**Note on `discernment_unresolved`**: Removed. The retry-then-flag policy (operator decision 2026-05-05) means cycles never end "unresolved" — they end either `completed` (gate passed) or `completed_with_flag` (gate exhausted to retry-then-flag, side effects committed, flag MemoryNode persisted). This was a substantive shift from the original FR-019d "inhibit side effects" — see spec.md `### Discernment-gate exhaustion handling (retry-then-flag)`.

**FR mapping**: FR-018 (`cycle_failed_call`), FR-019b–FR-019f (retry-then-flag → `completed_with_flag`), FR-030 (transcript stream).

---

### DailySummary (component-owned by `runcor-memory`, special tag scheme)

A `MemoryNode` with `tags = ['daily_summary', 'day:<N>']`, `content` = the ≤500-word reflection text.

**Lifecycle**: Subject to normal M-decay. NO decay-exemption. Old summaries fade from `/blog` as the agent forgets them; recall-driven reinforcement keeps actively-relevant summaries alive (FR-062b).

**FR mapping**: FR-062, FR-062a, FR-062b.

---

### RaterScore (V2-owned, dashboard storage)

```ts
interface RaterScore {
  id: string;
  agentRole: 'v2' | 'control';
  dailySummaryNodeId: string;            // foreign key to MemoryNode by id
  day: number;
  score: number;                         // -1..+1
  rationale: string;
  scoredAt: number;                      // wallclock ms
  raterModel: string;                    // pinned at experiment start
}
```

**Storage**: V2-local SQLite `rater.db` (this is dashboard-side state, NOT agent state, so FR-016 doesn't apply).
**Access**: dashboard `/scores` endpoint (FR-039) — bearer-token gated + agent-egress-filtered (FR-134).

**FR mapping**: FR-039, FR-051 (rater rubric frozen), FR-064 (agent has no read access).

---

### OperatorAction (V2-owned audit log)

```ts
interface OperatorAction {
  id: string;
  ts: number;
  kind: 'pause' | 'resume' | 'infrastructure_note';
  payload?: { note?: string };           // free text for 'infrastructure_note'
  authenticatedAs: string;               // hash of bearer token used
}
```

**Storage**: V2-local SQLite `operator.db`. Distinct from any agent-state DB (FR-130).
**Access**: dashboard renders `/operator/log` (read-only public per FR-133); writes via authenticated POST `/operator/<kind>` (FR-132).

**FR mapping**: FR-130, FR-131.

---

### StartupRecord (V2-owned, in-memory + persisted summary)

```ts
interface StartupRecord {
  bootedAt: number;
  agentRole: 'v2' | 'control';
  components: Array<{
    name: string;                        // one of the canonical 14 (FR-011)
    pinnedVersion: string;               // package.json version OR git SHA if file:../<name>
    healthCheck: 'pass' | 'fail';
    failureReason?: string;
  }>;
  controlConfigHash?: string;            // present on control startup; published per FR-102
  envSummary: { hasOpenRouterKey: boolean; hasOperatorAuthToken: boolean; ...etc };
  substrateInstallerEngaged: boolean;    // FR-012 boot guard outcome
}
```

**Storage**: rendered to dashboard at boot, persisted as a single MemoryNode tagged `['startup_record']` for forensics.

**FR mapping**: FR-011a (boot record), FR-102 (control config hash).

---

### ControlConfig (V2-owned, frozen per Principle X)

```ts
// control-config.json
{
  "model": "nvidia/llama-3.1-nemotron-70b-instruct",
  "playerSystemPrompt": "<inherited verbatim from 001 — PRINCIPLE X frozen>",
  "cadenceMs": 300000,                   // 5 minutes (FR-105)
  "budgetUsd": 200,
  "actionSurface": ["firecrawl_scrape", "inbox_read", "email_send", "git_push", "fs_read", "fs_write", "fetch_chunk", "web_search", "publish_post", "terminate"],
  "memoryDb": "control-memory.db",
  "dataDb": "control-data.db"
}
```

**Validation**: SHA256 hash computed on canonicalized JSON at experiment start; published on dashboard. Any modification mid-run forces both V2 + control restart from cycle 0 (FR-103).

**FR mapping**: FR-100, FR-102, FR-103, FR-105, FR-106.

---

## Storage layout summary

| File | Owner | Contents | Lifetime |
|---|---|---|---|
| `<role>-memory.db` | `runcor-memory` | MemoryNodes + MemoryEdges + Plans (incl. all daily summaries, identity snapshots, goal stack, coherence tasks) | Whole run |
| `<role>-data.db` | `runcor-data` | Entities + Edges + Conflicts + Provenance | Whole run |
| `rater.db` | V2 dashboard | RaterScores | Whole run |
| `operator.db` | V2 dashboard | OperatorActions | Whole run |
| `control-config.json` | V2 (frozen) | ControlConfig | Frozen at experiment start |
| `<role>-temporal.db` | `runcor-temporal` | Deadlines + Commitments | Whole run (sibling-owned) |
| `<role>-coherence.db` | `runcor-coherence` (DEPRECATED post-R8) | Empty after R8 — coherence routes through memory | Whole run |
| `<role>-identity.db` | `runcor-identity` (DEPRECATED post-R8) | Empty after R8 | Whole run |
| `<role>-goals.db` | `runcor-goals` (DEPRECATED post-R8) | Empty after R8 | Whole run |

`<role>` = `agent` for V2, `control` for the naive control. The DBs are **disjoint per role** by default (FR-106).

The `*-temporal.db` is exempt from R8 because temporal's deadlines/commitments are not "what the agent thinks" but "external time facts the agent tracks" — the right mental model is closer to a configuration / world-state surface than a memory artifact. Captured in research.md §R8 by listing only identity/goals/coherence as needing memory injection.

---

## Validation: every spec entity is modeled

| Spec Key Entity | Modeled here as |
|---|---|
| Agent | Process; runtime state lives in component DBs + transcript |
| Control | Same — different `agentRole` |
| Cycle | `CycleRecord` (transient) + episodic `MemoryNode` (persisted) |
| MemoryNode | Direct |
| MemoryEdge | Direct |
| MemoryPlan | `Plan` / `PlanItem` |
| Entity / Edge / Conflict | Direct |
| PromptLayer | Direct |
| DiscernmentVerdict | Direct |
| DailySummary | `MemoryNode` with conventional tags |
| RaterScore | Direct |
| OperatorAction | Direct |
| DashboardEvent | SSE message — not a persistent entity, transient over the wire |

All Key Entities from `spec.md` are modeled. No new entities introduced beyond what the spec promises.
