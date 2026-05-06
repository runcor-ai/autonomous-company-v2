# Quickstart: V2 Faithful Rebuild

**Branch**: `002-faithful-rebuild` | **Date**: 2026-05-05
**Audience**: implementer running V2 locally for the first time, or smoke-testing post-deploy.

This document is the shortest path from a fresh clone to "V2 boots, all 14 components engaged, the substrate gate is enforced, dashboard reachable." It assumes Phase-0 sibling work (3 scaffolded repos + 4 sibling extensions) has been completed — see `tasks.md` for that sequence.

## 0. Prerequisites

- Node 20.6+ (`node --version` must show ≥ 20.6).
- The V2 repo at `C:/runcor May 3 2026/autonomous-company-v2/` (you're here).
- All 14 sibling repos at `C:/runcor May 3 2026/<name>/`:
  - **Existing**: `runcor`, `runcor-memory`, `runcor-temporal`, `runcor-coherence`, `runcor-dialectic`, `runcor-drives`, `runcor-goals`, `runcor-identity`, `runcor-meta`, `runcor-skills`, `runcor-watchdog`.
  - **Phase-0 scaffolded**: `runcor-substrate`, `runcor-data`, `runcor-integration` (see research.md R3 / R5 / R6).
  - **Phase-0 extended**: `runcor-temporal` (with `computeNextWake` + `isDayBoundary` per R7), `runcor-identity` / `runcor-goals` / `runcor-coherence` (with optional `memory` constructor option per R8).
- A `.env` file at the V2 repo root with all required keys (see step 2 below).

## 1. Install dependencies

```bash
npm install
```

`package.json` lists all 14 siblings as `file:../<name>`. If any sibling is missing on disk, install fails at this point — that's expected (FR-011 enforced even at install time).

Cross-check that all 14 are resolvable:

```bash
npm ls runcor runcor-substrate runcor-memory runcor-data runcor-integration runcor-dialectic runcor-meta runcor-watchdog runcor-skills runcor-drives runcor-identity runcor-goals runcor-temporal runcor-coherence
```

All entries should show their pinned local paths with no `(missing)` markers.

## 2. Configure environment

Create `.env` at the repo root with these variables (all required):

```
# Model provider
OPENROUTER_API_KEY=...

# Operator auth (FR-132)
OPERATOR_AUTH_TOKEN=<a-strong-secret>

# Outward-action credentials (the local MCP module's tools — FR-200)
FIRECRAWL_API_KEY=...
RUNNER_EMAIL_USER=...
RUNNER_EMAIL_PASS=...
RUNNER_EMAIL_IMAP_HOST=...
RUNNER_EMAIL_SMTP_HOST=...
GIT_PUSH_REPO=https://github.com/runcor-ai/runner-v2-thoughts.git
GIT_PUSH_TOKEN=...

# Web search provider (one of)
BRAVE_SEARCH_API_KEY=...
# OR
SERPAPI_API_KEY=...

# Rater (out-of-band scorer)
RATER_MODEL=claude-3-5-sonnet-latest
RATER_INTERVAL_MS=60000

# Run policy
MAX_CYCLES=1000
CONTROL_BUDGET_USD=200
CONTROL_INTERVAL_SECONDS=300

# Dashboard
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PORT=8080
DASHBOARD_PUBLIC_URL=http://localhost:8080

# Optional (production only)
RAILWAY_TOKEN=...
```

Run the preflight check (validates all required keys, tries OpenRouter handshake without burning quota):

```bash
npm run preflight
```

Preflight MUST pass before continuing. Failures: missing env vars, OpenRouter unreachable, missing sibling repos, unwritable scratchpad.

## 3. Build

```bash
npm run typecheck   # Must pass with zero errors.
npm run build       # Outputs dist/.
```

Type errors here likely indicate sibling-side breaking changes — confirm pinned versions in `package.json` match what each sibling's `dist/` exports.

## 4. Smoke test

Run the full test suite — this is the regression floor:

```bash
npm test
```

The 001 baseline was 90 tests; 002 should have at minimum that many plus the new boot-guard / installer-engagement / atomicity / memory-recall / data-cube / dynamic-tools coverage (`tests/integration/*`).

Pay attention to:
- `boot-guard.spec.ts` — every one of the 14 components must produce a fail-closed boot when removed.
- `installer-engagement.spec.ts` — substrate's `isInstalled(engine)` must be `true` after `install` and `false` before.
- `control-parity.spec.ts` — V2 and control share engine + substrate signature on every call.

## 5. Run V2 + control + dashboard locally

Three terminals (or a process manager):

```bash
# Terminal 1 — dashboard server
node dist/main.js dashboard

# Terminal 2 — V2 agent
node dist/main.js agent

# Terminal 3 — naive control
node dist/main.js control
```

`main.js` reads its first CLI arg (`agent`, `control`, `dashboard`) and routes to the appropriate entry. Each is a standalone Node process per FR-104.

Open `http://localhost:8080` in a browser. You should see:
- The startup record (14 components ✅, substrate installer engaged ✅).
- An empty transcript stream (no cycles yet).
- `/memory` and `/data` showing empty stats.
- `/identity` showing "no identity yet" (FR-001 — discovered, not seeded).
- `/goals` showing an empty goal stack.
- `/drives` showing the four neutral pressures.

Within ~30s the first V2 cycle should fire and the transcript SSE should pop with:
- `prompt_assembled` event with `nonEmptyLayers: ['laws', 'drives', 'capabilities']` (cycle 0 — FR-076b).
- `adapter:tool_call` if the agent invokes anything.
- `cost:request` per model call.
- `cycle_record` for the cycle outcome.

## 6. Verify the substrate gate is engaged

Hit the dashboard's `/startup-record` endpoint:

```bash
curl http://localhost:8080/startup-record | jq .substrateInstallerEngaged
```

MUST return `true`. If `false`, the boot-guard (FR-012) failed to detect non-engagement — file a bug, **do not run the experiment**.

Also verify there's no direct provider call in V2 source:

```bash
# From repo root — should return zero results
grep -r "openrouter.ai/api" src/ --exclude-dir=node_modules
grep -r "from 'openrouter'" src/ --exclude-dir=node_modules
grep -rE "import.*Anthropic|import.*OpenAI" src/ --exclude-dir=node_modules
```

Each grep must produce 0 lines. The lint guard at `src/shared/lints/no-direct-provider.ts` is the long-term enforcement; the manual greps are a smoke check.

## 7. Verify operator auth

Without bearer token (must 401):
```bash
curl -i -X POST http://localhost:8080/operator/pause
# HTTP/1.1 401 Unauthorized
```

With bearer token (must succeed):
```bash
curl -i -X POST http://localhost:8080/operator/pause \
  -H "Authorization: Bearer $OPERATOR_AUTH_TOKEN"
# HTTP/1.1 200 OK
```

Public read endpoint (must work without bearer):
```bash
curl http://localhost:8080/transcript?limit=5 | jq .
```

## 8. Verify cycle-0 contract

Open the first transcript line for V2. Verify in the prompt-assembled event:
- `nonEmptyLayers` includes `laws`, `drives`, `capabilities`.
- `nonEmptyLayers` does NOT include `goals`, `identity`, `memory_recall`. (FR-001, FR-076b.)
- `reality` may be absent depending on whether the cube has any boot-time content (it shouldn't).

## 8a. Spot-check daily-summary visibility (FR-063)

When the first day boundary fires (default: every 200 cycles or 24 real hours, whichever first), the agent calls `publish_post`. Verify the summary appears at `/blog` within 60 seconds:

```bash
# Wait for the first publish_post event in the SSE transcript (look for `event: adapter:tool_call` with `tool: 'publish_post'`)
# Then within 60s:
curl -s http://localhost:8080/blog | jq '.entries[0]'
```

The newest entry should match the just-published summary. Soft check only — not gated in CI (single-replica system, no SLO).

## 9. Run for a few cycles, verify accumulation

After ~10 cycles:
- `/memory` should show some MemoryNodes (episodic entries from `memory.record(...)` post-cycle).
- `/data` should show some Entities (data cube ingestion outputs).
- The cycle 5+ prompt should show `memory_recall` populated (recalled MemoryNodes from `memory.query(queryText, topK)`).
- `/blog` may still be empty until the first day boundary fires (FR-060: 24h or 200 cycles, whichever first).

## 10. Termination

Either wait for the agent to call `terminate()` (could be never), or one of:
- 1000 cycles reached (FR-110).
- $200 budget exhausted (FR-110).
- Operator pauses indefinitely (different from termination — see FR-051).

On termination, `result.md` is auto-published to the configured public repo (FR-120, FR-121).

## Common failure modes

- **Boot fails with "component X missing"**: a sibling repo isn't on disk OR isn't listed in `package.json`. Add `file:../<name>` and `npm install`.
- **`substrateInstallerEngaged: false`**: substrate scaffolding incomplete. Re-check `runcor-substrate/src/installer.ts` against research.md §R4.
- **All cycles record `cycle_failed_call`**: OpenRouter unreachable, or `OPENROUTER_API_KEY` invalid. Check provider health on dashboard.
- **`memory_recall` layer always empty**: `memory.query()` returns []. Likely cause: embedding API key missing or `topK` defaulting to 0. Inspect `runcor-memory` config.
- **Dashboard 401 on `/scores` even with token**: the agent-egress filter (FR-134) is matching your IP. Either unset the filter for local dev or test from a different IP.

## Resetting between dev runs

```bash
rm -f agent-memory.db agent-data.db control-memory.db control-data.db rater.db operator.db
rm -rf scratchpad/
```

Each agent role gets its own pair of DBs (FR-106). Removing them gives a fresh cycle 0.

## Production deployment

Production runs on Railway (`reliable-eagerness` project, `v2` service — currently STOPPED per CLAUDE.md §11). After Phase 1 + Phase 2 (tasks) are complete:

1. Push to `main` → Railway auto-deploys (do NOT push during planning).
2. Verify the Railway dashboard shows the build green.
3. Hit `https://runner-v2.runcor.ai/startup-record` and confirm `substrateInstallerEngaged: true` + all 14 components green.
4. Tail SSE on `/transcript` for ~30 minutes to confirm the cycle loop is healthy.

If anything is wrong at this point, **stop the deployment** — `result.md` and reputation are downstream of correctness here, and Principle X (control sacred) means a partial-fix mid-experiment requires a full restart from cycle 0.
