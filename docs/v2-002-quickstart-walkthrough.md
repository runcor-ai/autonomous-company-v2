# V2-002 quickstart walkthrough

This is the operator-facing "I just cloned the repo, what now" runbook for V2-002 — the
faithful-rebuild milestone. It complements `specs/002-faithful-rebuild/quickstart.md`
(the spec-side reference) by walking through the concrete commands a fresh operator
would run, in order, and what they should see at each step.

The walkthrough does NOT push V2 to main — pushing to main triggers Railway auto-deploy
per `CLAUDE.md §11`. That is the operator's go/no-go decision after this walkthrough.

---

## 0. Prerequisites

- Node ≥ 20.6 (the `engines.node` field in `package.json`).
- The 14 sibling repos at `C:/runcor May 3 2026/<sibling>` (these resolve via `file:../<name>` in
  `package.json`). Phase 0 of `tasks.md` lists them all.
- A `.env` at the repo root with at minimum:
  - `OPENROUTER_API_KEY` (required for all model calls)
  - `OPERATOR_AUTH_TOKEN` (required for /operator/* endpoints)
  - `OPENAI_API_KEY` (required: runcor-memory + runcor-data use OpenAI embeddings)
  - Optional capabilities: `FIRECRAWL_API_KEY`, `RUNNER_EMAIL_*`, `GIT_PUSH_*`

---

## 1. Install + typecheck + lint

```bash
cd "C:/runcor May 3 2026/autonomous-company-v2"
npm install              # resolves all 14 siblings via file: deps
npm run typecheck        # tsc --noEmit
npm run lint             # both no-direct-provider + no-laws-literal pass
```

Expected:
- `npm install` prints no errors and the 14 siblings resolve.
- `npm run typecheck` exits 0.
- `npm run lint` prints two `OK` lines (no direct provider imports + no LAWS literal).

Failure here: the 14 siblings are out of sync. Re-run `git pull` in each sibling repo and
verify `package.json` versions match what `package.json` `dependencies` references.

---

## 2. Test suite

```bash
npm test
```

Expected: **137 passed / 5 skipped** (skips require `OPENAI_API_KEY` for embedding-backed
memory + data tests; once the key is set those become 142 passed).

Failure here: see the test name + path; the assertion message will say what was expected.
Most tests are source-grep verifications of cycle-protocol invariants (FR-018 atomicity,
FR-076b cycle-0 memory-recall, FR-019d retry-then-flag), so a failure usually means
someone changed `cycle.ts` / `side-effects.ts` / `boot.ts` in a way that drifts from the
spec. The fix is to bring the source back in line, NOT to weaken the test.

---

## 3. Preflight (env + sibling sanity)

```bash
npm run build && npm run preflight
```

`preflight` verifies:
- All required env vars are present.
- All 14 sibling components resolve.
- Storage paths writable.

Failure here: missing env or a sibling not resolving. `npm install` would normally have
caught the sibling case; an env miss is the more common failure.

---

## 4. Smoke-run V2 (real model, low budget)

V2 reads `V2_BUDGET_USD` from `.env` (default `5` in the working .env) for an experiment
budget cap. The first cycle costs ~$0.005-$0.01 depending on the model. Set
`MAX_CYCLES=3` for a smoke-run.

```bash
MAX_CYCLES=3 V2_BUDGET_USD=0.10 npm start agent
```

Expected:
- Boot prints `[v2]` lines for each of the 14 components.
- Dashboard reachable at `http://localhost:8080/healthz` (returns `{ ok: true }`).
- `http://localhost:8080/startup-record` lists 14 components, each with `healthCheck: 'pass'`.
- The cycle loop runs ~3 cycles, hits maxCycles, generates `result-v2.md` in `agent-state/`.
- `result-v2.md` is published to `git_push_repo` if creds are set; otherwise local-only.

Failure here:
- Substrate not engaged → boot exits with `[boot] runcor-substrate: ...`. Check `installer.install`
  call site in `boot.ts:209-216` and verify `assertInstallerEngaged` finds the brand.
- Memory boot fails on missing `OPENAI_API_KEY` — the embedding service requires it.

---

## 5. Smoke-run control

```bash
MAX_CYCLES=3 npm start control
```

Expected:
- Same boot, but with `cognitiveDisabled: true` (FR-101: identity / goals / coherence /
  watchdog / skills / dialectic NOT constructed).
- Single-Player call per cycle.
- Fixed cadence (5min default; smoke can lower with `CONTROL_INTERVAL_SECONDS=10`).
- `control-config.json` hash published in StartupRecord (FR-102).

---

## 6. Dashboard surfaces (manual checks)

With V2 running, in another terminal:

```bash
# Read-only views of accumulated state
curl http://localhost:8080/memory                    # FR-022: { stats, nodes, edges, plan, cursor, hasMore }
curl http://localhost:8080/data                      # FR-022: { stats, entities, openConflicts, cursor, hasMore }
curl http://localhost:8080/blog                      # daily summaries (filtered by daily_summary tag)
curl http://localhost:8080/identity                  # identity_snapshot MemoryNodes
curl http://localhost:8080/goals                     # plan from runcor-memory
curl http://localhost:8080/result                    # result.md after termination

# Operator (bearer-gated, FR-132)
curl -X POST http://localhost:8080/operator/pause \
  -H "Authorization: Bearer $OPERATOR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"v2"}'

# Scores (bearer + agent-egress filter, FR-134)
curl http://localhost:8080/scores \
  -H "Authorization: Bearer $OPERATOR_AUTH_TOKEN"

# Live transcript
curl -N -H "Accept: text/event-stream" http://localhost:8080/transcript
```

Expected: each route returns the documented JSON shape (see `contracts/dashboard-api.md`).
401 without bearer on operator routes; 403 from agent-egress IPs on `/scores` even with
bearer.

---

## 7. The two punch-list items the operator MUST run

These cannot be automated — they require the operator's session.

1. `/speckit.analyze` — runs cross-artifact consistency check across spec.md, plan.md,
   tasks.md, contracts/, data-model.md. Flags any drift. Fix any flagged item before
   tagging `v2-002-rc1`.

2. **`/scores` egress validation against the real Railway IP** — the `AGENT_EGRESS_IPS`
   env var must be set to the Railway service's egress IP before deploy. Verify with
   `curl /scores` from the Railway shell and from outside; the agent-side curl must 403,
   the outside curl with bearer must 200.

---

## 8. Local tag (for the implementation milestone)

After the two operator checks pass:

```bash
git tag -a v2-002-rc1 -m "V2-002 implementation milestone — faithful-rebuild ready for operator review"
```

**Do NOT push the tag to remote yet.** Pushing to `main` triggers Railway auto-deploy
per `CLAUDE.md §11`. The tag stays local until the operator's go decision.

---

## 9. Operator go/no-go decision

Tag in hand and walkthrough green: bring this checklist back to the operator. The operator
either:
- **Go**: pushes the branch + tag to `main` (triggering Railway redeploy of V2-002).
- **No-go**: surfaces what's missing or wrong; another iteration follows.

The build does NOT auto-push. This is by design (Principle X — the operator owns the
contamination boundary; the implementation surface is held back from production until
the operator personally signs off).
