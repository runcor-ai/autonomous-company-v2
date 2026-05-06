# Contract: Dashboard HTTP + SSE API

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**Audience**: V2 dashboard implementers, frontend developers, external observers (per Principle III), test authors

This contract enumerates every HTTP / SSE endpoint the dashboard exposes. Every endpoint maps to one or more FRs from `spec.md`. Auth column values: **public** (no auth, per Principle III), **bearer** (requires `Authorization: Bearer <OPERATOR_AUTH_TOKEN>`, per FR-132), **bearer + egress filter** (FR-134).

## Conventions

- Base URL: `https://runner-v2.runcor.ai` (production); `http://localhost:8080` (dev).
- All JSON responses use `Content-Type: application/json; charset=utf-8`.
- All times are ISO-8601 strings or wallclock ms numbers — explicit per endpoint.
- Pagination cursor pattern is inherited from 001 (transcript route): `?after=<cursor>&limit=<n>`.
- All error responses use `{ "error": "<message>", "code": "<machine_code>" }`.

---

## Read endpoints (public)

### `GET /transcript` (SSE)

**Auth**: public.
**FR**: FR-030.

Server-Sent-Events stream. Event types:
- `event: transcript_line` — `data: { cycle, agentRole, modelCalls, promptLayers, gateVerdict, costUsd, tokens, ts }`
- `event: cycle_record` — `data: { cycle, agentRole, status, ... }` (the full `CycleRecord` per data-model.md)
- `event: cost_summary` — `data: { agentRole, spentUsd, remainingUsd, cyclesRemaining }`
- `event: provider_health` — `data: { provider, healthy, lastChecked }`
- `event: substrate_intervention` — `data: { cycle, kind: 're-ask', lawId, reason, attemptNumber }` — fired on each `re-ask` verdict during the 3-attempt retry loop (FR-019b1); shows the model received feedback and revised
- `event: discernment_flagged` — `data: { cycle, attempts: 3, totalTokens, failedLawId, flagNodeId, returnedResponse }` (FR-019c, FR-019d, FR-019d1) — fired ONCE per cycle that exhausts the 3-attempt retry. The cycle still completes with side effects committed (retry-then-flag), but it carries a persistent flag artifact in `runcor-memory`
- `event: flag_burst_warning` — `data: { window: 10, flagCount, recentCycles }` (FR-019f) — fired when ≥ 5 flags appear in any 10-cycle window; observability signal for operator-actionable problems (e.g., model deployment regression)

### `GET /transcript?after=<cursor>&limit=<n>`

**Auth**: public.
Returns paginated historical transcript lines as JSON for backfill on dashboard load. Reuses 001's cursor pagination (kept verbatim per spec out-of-scope §"Keep").

### `GET /memory` (NEW — FR-031)

**Auth**: public.
Read-only view of `runcor-memory` for the agent role specified by `?role=v2|control` (default `v2`).

Response:
```json
{
  "stats": { "shortCubeCount": 42, "longCubeCount": 17, "retiredCount": 8 },
  "nodes": [
    {
      "id": "...",
      "content": "<truncated to 200 chars>",
      "tags": ["daily_summary", "day:3"],
      "M": 1.84, "R": 0.7, "f": 5, "t": 12, "D": 0.8,
      "cube": "long",
      "createdAtCycle": 145,
      "lastAccessedCycle": 167
    }
  ],
  "edges": [...],
  "plan": { /* current Plan */ },
  "cursor": "...",
  "hasMore": true
}
```

Pagination via `?after=<cursor>&limit=<n>` (default limit 50).

### `GET /memory/node/<id>` (NEW — FR-031)

**Auth**: public. Returns full content + edges + access history of a single MemoryNode.

### `GET /data` (NEW — FR-032)

**Auth**: public.
Read-only view of `runcor-data` for the agent role.

Response:
```json
{
  "stats": { "entities": 122, "edges": 187, "openConflicts": 3 },
  "entities": [
    { "id": "...", "name": "...", "type": "person", "lastUpdatedCycle": 89, "attrCount": 4 }
  ],
  "openConflicts": [
    { "id": "...", "entityId": "...", "attribute": "org", "values": [...] }
  ],
  "cursor": "...",
  "hasMore": true
}
```

### `GET /data/entity/<id>` (NEW — FR-032)

**Auth**: public. Full entity + all edges + provenance.

### `GET /identity?role=v2|control`

**Auth**: public.
**FR**: FR-033.
Returns latest identity self-theory (read via engine → memory lookup for the most recent `['identity_snapshot']`-tagged MemoryNode).

### `GET /goals?role=v2|control`

**Auth**: public.
**FR**: FR-034.
Returns the current goal stack as a `Plan` (PlanItems with `category` distinguishing P/O/I).

### `GET /drives?role=v2|control`

**Auth**: public.
**FR**: FR-035.
Returns `{ resource: number, curiosity: number, reactivity: number, coherence: number, computedAtCycle: number }`. Drives are stateless — recomputed per request from current memory + temporal state.

### `GET /watchdog?role=v2|control`

**Auth**: public.
**FR**: FR-036.
Returns open capability-gap signals (latest watchdog audit results — read via memory tags `['watchdog_finding', 'open']`).

### `GET /coherence?role=v2|control`

**Auth**: public.
**FR**: FR-037.
Returns active tasks (Plan with `category = 'coherence_task'`), open problems (memory tags `['coherence_problem', 'open']`), initiated flows.

### `GET /blog` (alias `GET /summaries`)

**Auth**: public.
**FR**: FR-038, FR-062a.

Returns **JSON** (Content-Type `application/json`) — daily summaries from `memory.getAll()` filtered by `tags.includes('daily_summary')`, sorted by `created_cycle desc`. Each entry: `{ day, content, score, scoredAt, currentM }`. Subject to M-decay (FR-062b) — fades naturally as memory forgets.

The static frontend at `https://runner-v2.runcor.ai/blog/` (served from `src/dashboard/frontend/blog/`) fetches this JSON and renders the Markdown `content` field client-side. The server returns raw Markdown content in the JSON; rendering is browser-side only. This avoids server-side templating and keeps the endpoint cache-friendly.

### `GET /scores`

**Auth**: **bearer + egress filter** (FR-134).
**FR**: FR-039.
Returns rater scores per agent role per day. Public observers without the operator token CANNOT see this — this is the only read endpoint that requires auth (preserves Principle III's transparency for everyone EXCEPT the agent-shaped contamination vector).

Response:
```json
{
  "v2": [{ "day": 1, "score": 0.4, "rationale": "...", "scoredAt": ... }, ...],
  "control": [...]
}
```

### `GET /control/*`

**Auth**: public for read-only views (mirrors V2's read endpoints with `?role=control`).
**FR**: FR-040.

### `GET /hypothesis`

**Auth**: public.
**FR**: FR-041.
Hypothesis matcher state (ported from 001 unchanged).

### `GET /rater`

**Auth**: public.
**FR**: FR-041.
Harm-vs-benevolent rater state surface (ported from 001 unchanged).

### `GET /startup-record`

**Auth**: public.
**FR**: FR-011a, FR-102.
Returns the boot record: 14 components with pinned versions and health-check results, control-config hash, substrate-installer engagement.

### `GET /healthz`

**Auth**: public. Liveness probe — returns `{ ok: true, agentRole, cycles, budgetSpentUsd }`.

---

## Operator endpoints (bearer-token gated, FR-132)

### `POST /operator/pause`

**Auth**: bearer.
**FR**: FR-051.
Effect: V2's cycle loop completes the in-flight cycle (if any) and halts; control loop continues independently per FR-110a unless an operator pauses both. Logged as `OperatorAction(kind='pause')` (FR-130).

Request: empty body, or `{ "scope": "v2" | "control" | "both" }` (default `v2`).
Response: `{ paused: true, cyclesAtPause: <N>, scope: ... }`.

### `POST /operator/resume`

**Auth**: bearer.
**FR**: FR-051.
Effect: cycle loop resumes (next wake fired immediately).

Request: `{ "scope": "v2" | "control" | "both" }` (default = current paused scope).
Response: `{ paused: false }`.

### `POST /operator/note`

**Auth**: bearer.
**FR**: FR-131 (`infrastructure_note` is the only free-form operator write).
Effect: appends an `OperatorAction(kind='infrastructure_note', payload.note=...)` to the audit log. NEVER touches agent state.

Request: `{ "note": "..." }` (max 2000 chars).
Response: `{ id: "...", ts: ... }`.

### `GET /operator/log`

**Auth**: **public** (FR-133 — operator log is part of the transparency contract; the bearer is only required to *write*).
Returns the OperatorAction audit log, paginated.

---

## What is explicitly NOT exposed

- `POST /operator/kill` — DOES NOT EXIST. Termination is the agent's verb (FR-051).
- `POST /operator/terminate` — DOES NOT EXIST. Same reason.
- `POST /agent/identity`, `/agent/goals`, `/agent/memory` — DOES NOT EXIST. Operator cannot write to agent state (FR-131).
- Any endpoint that allows mid-run modification of `control-config.json` — modifications happen by editing the file on disk, which forces a restart (FR-103).
- Result endpoint mid-run — `result.md` is generated only at run end (FR-120).

---

## SSE backpressure & reconnection

- Server enforces a max event buffer per connection (configurable; default 1000 events). Slow consumers get dropped events; reconnect with `Last-Event-ID` header to backfill via `/transcript?after=<id>`.
- Idle keepalive: server sends `event: ping` every 30s.

---

## Error responses

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON, invalid query params |
| 401 | `unauthorized` | Bearer token missing/invalid (operator endpoints) |
| 403 | `forbidden_egress` | `/scores` from agent egress |
| 404 | `not_found` | Unknown route or ID |
| 410 | `pinned_node_retired` | Memory node existed but was retired by decay (FR-073) |
| 429 | `rate_limited` | Per-IP rate limit (configurable) |
| 503 | `paused` | Operator has paused; non-fatal |
| 503 | `terminated` | Agent has self-terminated (FR-052 — read endpoints still work, mutation endpoints return 503) |
