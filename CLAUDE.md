# CLAUDE.md — autonomous-company-v2

This file is the **fresh-session bootstrap**. A new Claude session should be able to drive the V2 rebuild end-to-end using nothing but this file plus `.specify/memory/constitution.md` and the spec-kit slash commands.

Read this top-to-bottom before doing anything. Do not skim.

---

## 0. What this repo is RIGHT NOW (2026-05-06)

- **Goal**: A primordial-agent emergence experiment. A single agent equipped with the runcor cognitive harness runs publicly alongside a parallel naive control. Success is qualitative emergence (Constitution Principle VIII).
- **Status**: **Feature 001 (`specs/001-primordial-agent/`) was built but failed faithfulness.** Live deployment at `runner-v2.runcor.ai` is **stopped** (see §11). We are now starting **feature 002 — a faithful rebuild**.
- **Last shipped commit on 001**: `89dbf4b`. Do **not** build on this code path. The 001 source under `src/` is reference material for the dashboard shell only; everything else is architecturally wrong (see §3).

---

## 1. The job for this fresh session

You are here because the operator wants to drive the rebuild via spec-kit. Do this in order:

1. Confirm `.specify/` and `.claude/commands/speckit.*.md` exist (they do — bootstrapped 2026-05-06).
2. Run `/speckit.specify` with the feature description in §2 below. This creates `specs/002-…/spec.md` from the template.
3. Run `/speckit.clarify` to surface ambiguities. The operator answers them.
4. Run `/speckit.plan` — this produces `specs/002-…/plan.md` + `research.md` + `data-model.md` + `contracts/` + `quickstart.md`.
5. Run `/speckit.tasks` — produces `specs/002-…/tasks.md`.
6. Run `/speckit.analyze` — constitution-check gate. **If any FR violates the constitution, STOP and surface it. Do not paper over.**
7. Only then `/speckit.implement`.

**Never build before the spec exists.** 001's failure was building from a vague mental model instead of the spec on disk.

---

## 2. The feature 002 description (paste into `/speckit.specify`)

> Rebuild V2 faithfully on the runcor engine + substrate + memory + data + integration. All 14 runcor components mandatory at boot — fatal startup error if any missing. The 5 missing in 001 must be present: `runcor` (engine), `runcor-substrate` (Laws + Reality + Discernment gate), `runcor-memory` (M = R·ln(f+1)·e^(-t/(τ·D)) decay, short/long cubes), `runcor-data` (entity/edge data cube), `runcor-integration` (schema discovery + dynamic MCP tools). Every LLM call routes through `runcor.modelRouter` — no direct OpenRouter clients. Every call wrapped by `runcor-substrate`: prompt-stack injection PRE-call (Laws + Reality + drives + goals + identity), discernment-gate POST-call. Cycle prompt assembled by substrate's `prompt-stack`, NOT hand-rolled. Next-wake from `runcor-temporal.computeNextWake` (drive pressures + commitments + coherence problems). Day-boundary from `runcor-temporal`. `runcor-memory` owns episodic→semantic consolidation: cycles' action results write into memory; subsequent cycles read consolidated knowledge back via recall, not a 5-action prompt slice. `runcor-data` captures entities + edges + conflicts learned across cycles; substrate's Reality slice reads from `runcor-data` so the prompt reflects accumulated facts. `runcor-integration` grows the outward action set dynamically from observed schemas. Identity reflection, goals proposal, skills proposal, watchdog audit all go through the engine and persist via memory's plan-rewrite pathway, not orphan SQLite tables. Naive control runs on the SAME engine + substrate but with NO cognitive harness — single-Player call only. Dashboard exposes `/memory` and `/data` endpoints (read-only views) plus all 001 surfaces (transcripts, summaries, hypothesis matcher, harm-vs-benevolent rater). Same constitution as 001 (already at `.specify/memory/constitution.md`). Success per Principle VIII: emergent behaviour traceable through the harness — point at a memory recall or discernment intervention or goal proposal and say "this is why, and a generic LLM would not have done it." Non-goals: no commercial framing, no new sibling components, don't preserve 001 source beyond dashboard shell + control prompt seed.

---

## 3. Why 001 failed (post-mortem — do NOT repeat these)

001's `package.json` installs **9 of 14** required runcor components (plus rpp-parser as auxiliary tooling). The 5 missing are exactly the ones that own the engine + substrate + memory + data + integration. The 10 cognitive siblings (drives, identity, goals, etc.) were sitting on top of nothing. Specific spec violations observed in 001 source:

| Violated FR (from `specs/001-primordial-agent/spec.md`) | What 001 did wrong | Evidence |
|---|---|---|
| **FR-010** — Every LLM call MUST route through `runcor` engine, MUST consult substrate (prompt-stack PRE + discernment-gate POST) | Direct OpenRouter calls via hand-rolled `OpenRouterClient` | `src/shared/openrouter.ts` |
| **FR-011** — All 14 components MUST initialize at boot. Failure to initialize ANY one is a fatal startup error | Only 10 components present; the boot guard at `src/agent/boot.ts:88` only checks the 10 it bothered to declare → no fatal error fires | `package.json` deps + `src/agent/boot.ts` |
| **FR-014** — Cycle prompt MUST be assembled by substrate's `prompt-stack` | Hand-rolled `assembleCyclePrompt` with hardcoded LAWS_BLOCK + ACTION_USAGE | `src/agent/prompts/cycle_prompt.ts` |
| **FR-020** — `next_wake` computed by `runcor-temporal` | Fixed-cadence sleep; later replaced with my own `computeNextSleepMs` based on drive intensity heuristic | `src/agent/index.ts` |
| **FR-022** — Dashboard `GET /memory` exposes read-only `runcor-memory` view | No such endpoint exists | `src/dashboard/server.ts` |
| **FR-034** — Day boundary detection by `runcor-temporal` | Hand-rolled `isDayBoundary` based on cycle count | `src/agent/daily.ts` |

**Behavioural consequence observed live** (cycle 200, $0.67/$5):
- Identity stayed at `v1, lastReflectedCycle: 0` (reflection silently failed every 20 cycles for 200 cycles — `versionCount: 1`)
- Goals empty (`0P/0O/0I`)
- Drive max 0.10 → no urgency
- Action mix: `fs_write × 8, fetch_chunk × 5, web_search × 1, web_scrape × 1, submit_analysis × 1` (last is hallucinated — not a real action)
- Agent stuck in read-summarize-write loop on a single deepfakes article
- Root cause: **no memory layer** to consolidate "I have learned enough about X" across cycles, and the harness components meant to be long-term anchors (identity / goals) were non-functional because they weren't being driven through the engine

The 001 cycle is essentially a stateless LLM seeing 4 fragments per cycle (Laws + empty Identity + empty Goals + last 5 actions). The locally-rational next move was always "continue what I just did."

---

## 4. The 14 components (mandatory at boot — FR-011)

Sibling repos live at `C:/runcor May 3 2026/<name>/` and are referenced by `file:../<name>` in `package.json` (Phase-2 strategy from `specs/001-primordial-agent/plan.md` §"Dependency strategy").

**Already installed (9 of 14) + 1 auxiliary (rpp-parser):**

| Repo | Role | Local path |
|---|---|---|
| `runcor-dialectic` | Player/Coach/Judge multi-model reasoning | `../runcor-dialectic` |
| `runcor-meta` | Calibration scoring + escalation events (NOT memory) | `../runcor-meta` |
| `runcor-watchdog` | Capability-gap audits + stated-but-not-acted matchers | `../runcor-watchdog` |
| `runcor-skills` | R++ skill synthesis from successful trajectories | `../runcor-skills` |
| `runcor-drives` | 4 drives: resource, curiosity, reactivity, coherence (no survival) | `../runcor-drives` |
| `runcor-identity` | `SelfTheory { version, claims[], traits, lastReflectedCycle }` via `reflect()` | `../runcor-identity` |
| `runcor-goals` | Purpose / Objective / Initiative stack via `propose()` + `accept()` | `../runcor-goals` |
| `runcor-temporal` | Deadlines, commitments, `forecast()`. **Does NOT have `computeNextWake` — see §5.** | `../runcor-temporal` |
| `runcor-coherence` | Multi-engine task orchestration (submit/route/parallel/checkCoherence/recombine) | `../runcor-coherence` |

Auxiliary tooling (NOT one of the 14 cognitive harness components, not subject to the boot guard):

| Repo | Role | Local path |
|---|---|---|
| `rpp-parser` | R++ language parser + validator (doc tooling) | `../rpp-parser` |

**Missing — MUST be cloned + added to `package.json` BEFORE coding (5):**

| Repo | Role | Origin |
|---|---|---|
| `runcor` | The engine: orchestration, MCP adapter, model routing, cost, policy, evaluation, discernment, telemetry | `git@github.com:runcor-ai/runcor.git` |
| `runcor-substrate` | Laws + Reality slice + Discernment gate. Wraps every LLM call via `installer.ts` monkey-patching `engine.modelRouter.complete`. Reality slice accepts an injected `DataCubeReader` | `git@github.com:runcor-ai/runcor-substrate.git` |
| `runcor-memory` | Long-chain memory: M = R·ln(f+1)·e^(-t/(τ·D)). 3 tables: `memory_nodes`, `memory_edges`, `memory_plans`. Short cube + long cube + promotion + decay + plan rewrite. **75 tests — most mature of all repos** | `git@github.com:runcor-ai/runcor-memory.git` |
| `runcor-data` | Data cube: entities + edges with conflict resolution. 5-stage pipeline: identify → normalize → relate → conflict → persist | `git@github.com:runcor-ai/runcor-data.git` |
| `runcor-integration` | Schema discovery + dynamic MCP tool generation from learned database patterns. SQLite-only today | `git@github.com:runcor-ai/runcor-integration.git` |

**First task in `/speckit.implement`**: clone the 5 missing siblings into `C:/runcor May 3 2026/`, add them to `package.json` deps as `file:../<name>`, run `npm install`. Until all 14 resolve, **no other work begins**.

---

## 5. Hard rules (carried over from 001 spec — these MUST be in 002 spec too)

1. **Every LLM call routes through `runcor.modelRouter`.** No `OpenRouterClient`, no `fetch('https://openrouter.ai/...')` anywhere except inside the `runcor` engine itself. (FR-010)
2. **Substrate wraps every call.** `runcor-substrate.installer` monkey-patches the model router. PRE-call: prompt-stack injection (Laws + Reality + drives + goals + identity). POST-call: discernment-gate. Bypassing either is a constitution violation. (FR-010 + Principle V)
3. **Cycle prompt comes from `prompt-stack`, not hand assembly.** No file like `cycle_prompt.ts` may contain a literal LAWS array or a hardcoded "TASK:" footer. Layers compose; `prompt-stack` owns the order. (FR-014)
4. **Memory consolidation is the long-term context, not "last 5 actions".** `runcor-memory` writes episodic entries every cycle (action + result + reasoning). Recall is the source for next-cycle context. The prompt does NOT carry raw `actions[]` rows. (FR derived from rebuild spec)
5. **Data cube is the world model.** Entities + edges learned across cycles live in `runcor-data`. Substrate's Reality slice reads from it. The prompt's "what does the agent know" comes from this source. (FR derived from rebuild spec)
6. **Temporal owns cadence + day boundary.** No fixed-cadence sleep, no hand-rolled `isDayBoundary`. If `runcor-temporal` does not currently expose `computeNextWake()`, **the rebuild adds it to runcor-temporal first**, then v2 calls it. Do not compensate by re-implementing the logic in v2. (FR-020 + FR-034)
7. **Identity / goals / skills / watchdog persist via memory's plan-rewrite path.** No standalone SQLite tables for identity snapshots / goal stacks / skill proposals / watchdog findings in v2's own DB. The cognitive components own their persistence; v2 reads via the engine.
8. **Boot guard MUST check all 14 slots.** Missing any one → throw on startup. The current `bootHarness` guard at `src/agent/boot.ts:88` only checks the 10 it instantiates — the rebuild's boot guard MUST be exhaustive against the canonical 14-name list. (FR-011)
9. **Naive control runs on same engine + substrate.** Single Player call. No dialectic, no meta, no watchdog, no identity, no goals, no drives, no temporal, no coherence, no memory, no data. Same `modelRouter`, same Laws, same Reality. The contrast IS the experiment. (Principle VI + X)
10. **Dashboard exposes `/memory` and `/data`.** Read-only. Plus everything 001 had: `/transcript/live` (SSE), `/v2/<panel>`, `/control/<panel>`, `/scores`, `/hypotheses`, `/<kind>/cycle-summary`, `/blog`. (FR-022 + 001 surfaces)

---

## 6. What to keep / discard from 001 source

**Keep (port to 002):**
- `src/dashboard/frontend/{index.html,app.js,style.css}` — UI shell. Add `/memory` + `/data` panels.
- `src/dashboard/server.ts` — HTTP scaffolding (route table). All `/v2/*` panel endpoints replaced; transcripts replaced; SSE bus stays.
- `src/dashboard/routes/transcript.ts` — pagination cursor stays.
- `src/rater/*` — fixed-rubric Claude rater stays (FR-051).
- `src/hypothesis/*` — emergence-claim evaluator stays (it judges trajectories, doesn't drive them).
- `src/control/index.ts`'s control prompt seed (the literal text passed to the naive Player) — Principle X says control config is frozen.

**Discard (do NOT port):**
- `src/shared/openrouter.ts` — direct OpenRouter; replaced by `runcor.modelRouter`.
- `src/agent/cycle.ts` — hand-rolled cycle protocol; replaced by engine's cycle driver.
- `src/agent/prompts/cycle_prompt.ts` — hand-rolled prompt; replaced by `prompt-stack`.
- `src/agent/dispatcher.ts` — hand-rolled action dispatcher; replaced by engine's MCP adapter + `runcor-integration` dynamic tools.
- `src/agent/daily.ts` — hand-rolled day boundary; replaced by `runcor-temporal`.
- `src/agent/boot.ts`'s 10-slot guard — replaced by 14-slot exhaustive guard.
- `src/shared/db.ts` skill_proposals table, hypothesis tables stay; cycles/actions/decisions tables become wrappers around memory/data reads.

**Uncertain — operator decides during `/speckit.clarify`:**
- Whether the existing `src/agent/dispatcher.ts` action implementations (Firecrawl scrape, IMAP read, SMTP send, Git push) are extracted into their own MCP server that `runcor-integration` discovers, or live inside the `runcor` engine. Spec the boundary, then implement.

---

## 7. The runcor-memory model (M decay)

```
M(t) = R · ln(f + 1) · e^(-t/(τ·D))
```

- `R` — reinforcement strength (incremented on each retrieval / update)
- `f` — frequency of access
- `t` — time since last access (cycles)
- `τ` — base decay constant
- `D` — depth multiplier (0 = working memory short-decay, 1 = long-cube long-decay)

Short cube → long cube **promotion** happens when `M` stays above a threshold for N retrievals. **Decay** retires nodes whose `M` falls below the floor. **Plan rewrite** is the consolidation pass: episodic events compress into semantic facts.

The 3 tables: `memory_nodes` (the entries), `memory_edges` (relations between entries), `memory_plans` (the consolidation outputs). **There is no `agent` column** — the cognitive harness does not get a separate memory namespace. v2 and the control share a memory instance only if the spec explicitly says so; default is two separate instances.

---

## 8. The runcor-data model (data cube)

5-stage pipeline per ingestion:

1. **identify** — extract entity candidates from raw input
2. **normalize** — canonicalize names, types, attributes
3. **relate** — build edges to existing entities
4. **conflict** — detect contradictions (same entity, different attribute values from different sources)
5. **persist** — write to the cube with provenance

Substrate's Reality slice queries the cube to populate the prompt's "what is true" section. This is what was missing in 001 — there was no "what does the agent know about deepfakes" structured representation, only raw fs_write files.

---

## 9. The runcor-substrate gate

Two responsibilities, both wrap `engine.modelRouter.complete`:

1. **Pre-call: prompt-stack injection.** Substrate prepends Laws block + Reality slice + drive pressures block + goal stack block + identity self-theory block to the prompt. Each layer is a `PromptLayer` interface; layers compose deterministically. The cycle's "user" content goes after these layers.
2. **Post-call: discernment gate.** The model's response is evaluated against the Laws (e.g. "does it cite evidence", "does it state assumptions"). Failures route to either a re-ask (via dialectic), a discard, or a flag (depending on Law). This is what stops the agent from "writing summaries to scratchpad" and calling it shipping.

The `installer.ts` monkey-patches the engine's `modelRouter.complete` so calls cannot bypass the gate even by direct instantiation. Do not "improve" the architecture by removing the monkey-patch — it is the enforcement mechanism.

---

## 10. Constitution (already at `.specify/memory/constitution.md`)

10 principles, all binding. Pinned summary:

I. No commercial framing • II. Discovered, not seeded • III. Transparency is the contract • IV. Full autonomy on termination • V. Cognitive substrate non-negotiable • VI. Control on same rails • VII. Negative results count • VIII. Qualitative success criteria • IX. No experimenter contamination • X. Control is sacred

The spec file at `.specify/memory/constitution.md` is the source of truth. `/speckit.analyze` will check 002's spec + plan against it.

---

## 11. Live deployment state (Railway)

**Stopped 2026-05-06.** No compute charges accruing.

| Field | Value |
|---|---|
| Project name | `reliable-eagerness` |
| Project ID | `fe842ed3-e6b1-48ea-9789-27c0da79c338` |
| Service name | `v2` |
| Service ID | `549eb6b9-71d7-4dfc-a5ea-69dc73cc5726` |
| Environment | `production` (`bbe95251-e54c-43a1-994f-01521be88338`) |
| Last deployment | `12cd8d41-f1a1-4819-8842-1898430317bd` (status: CRASHED — manually stopped via `deploymentStop`) |
| Public URL | `https://runner-v2.runcor.ai` (502 — confirmed down) |
| Persistent volume | Mounted at `/agent-state/` — SQLite + scratchpad preserved for forensics |
| Auto-deploy on `git push origin main` | **YES** — pushing to main re-triggers Railway. **Do not push during planning phase.** |

**To resume after rebuild**: redeploy from Railway dashboard, or push a new commit (auto-deploy fires). Current HEAD `89dbf4b` will produce the broken 001. Redeploy ONLY after 002 is implemented and on main.

**Env vars in production** (from `.env`, all already set in Railway): `OPENROUTER_API_KEY`, `OPERATOR_AUTH_TOKEN`, `FIRECRAWL_API_KEY`, `RUNNER_EMAIL_*` (IMAP+SMTP), `GIT_PUSH_REPO`, `GIT_PUSH_TOKEN`, `RATER_MODEL`, `MAX_CYCLES`, `CONTROL_BUDGET_USD`, `CONTROL_INTERVAL_SECONDS`, `RATER_INTERVAL_MS`, `DASHBOARD_HOST`, `DASHBOARD_PORT`, `DASHBOARD_PUBLIC_URL`, `RAILWAY_TOKEN` (for ops).

**Railway GraphQL via curl** (project token in `.env` as `RAILWAY_TOKEN`):
```bash
curl -X POST https://backboard.railway.com/graphql/v2 \
  -H "Project-Access-Token: $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"..."}'
```

---

## 12. Build / test / typecheck commands

```bash
npm run typecheck      # tsc --noEmit
npm test               # vitest run (full suite)
npm run build          # tsc -p tsconfig.json (writes dist/)
npm start              # node dist/main.js  (loads .env via dotenv)
npm run preflight      # node dist/scripts/preflight.js  (env-var sanity check)
```

Test count at 001 HEAD: **90/90 passing**. Use these as the regression floor.

---

## 13. Build methodology (from operator's standing instruction)

> Every component is built as its own runcor-family repo first; folding into autonomous-company-engine is a separate downstream decision.

In practice for 002: if a missing capability is needed (e.g. `runcor-temporal.computeNextWake`), the rebuild **adds it to that sibling repo first**, ships it as a new sibling version, then v2 consumes it. v2 does not absorb sibling responsibilities.

---

## 14. Things the operator cares about (don't violate)

- **No band-aid prompt patches.** Adding "Law 13: shipping ≠ summarizing" to a hand-rolled prompt is the wrong layer. Fix the architecture.
- **No silent failures.** If `identity.reflect()` throws, surface it on the dashboard. The 001 `try { ... } catch (e) { console.warn(...) }` pattern hid 9 consecutive failures and made the agent appear to be working.
- **No hand-rolled substitutes for missing sibling APIs.** If `runcor-temporal` doesn't expose `computeNextWake()`, add it to `runcor-temporal` — don't reimplement in v2.
- **Be willing to STOP.** When the user pushes back, stop and re-orient. Do not continue piling fixes.
- **Trust the spec.** 001 failed because the build deviated from the spec without anyone noticing. `/speckit.analyze` exists to prevent that — run it.

---

## 15. Auxiliary repos / context

- **rpp** (`github.com/runcor-ai/rpp`) — R++ spec language v0.5, doc-only (37KB ref + 9KB conversion skill). LLM-read, no parser. Top-level blocks: TARGET, TOKENS, FORMAT, MAP, DATA, INIT, STRUCTURE, COMPONENT, BEHAVIOR, CHECKLIST.
- **autonomous-company-engine** (`github.com/runcor-ai/autonomous-company-engine`, PRIVATE) — V1, deployed at `runner.runcor.ai`. Multi-agent (CEO/Marketing/Product/Sales) on runcor + 48 MCP tools. Cron at `index.js:1178` is DISABLED since 2026-04-07. Has 3 dead-code subsystems (`runners.js`, `meta-agent.js`, `ceo-workflow.js`). **Do not import V1 patterns into V2** — V1 was a commercial demo, V2 is an experiment (Principle I).
- **runcor.ai** — public site. V1 card + V2 card live. V2 card currently links to `runner-v2.runcor.ai` (which is 502).

---

**End of bootstrap.** Now run `/speckit.specify` with the description in §2.
