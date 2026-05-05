# Tasks: autonomous-company-v2 v0.1.0

## Phase 1 — Repo scaffold + governance docs ✅ THIS PHASE

- [x] Create directory `autonomous-company-v2/`
- [x] `package.json` — name, scripts, deps placeholder, runcor attribution
- [x] `tsconfig.json` — strict, ESM, NodeNext, ES2022
- [x] `vitest.config.ts`
- [x] `LICENSE` — MIT, runcor
- [x] `README.md` — public-facing experiment description
- [x] `CLAUDE.md` — speckit pointer
- [x] `.gitignore`
- [x] `specs/001-primordial-agent/constitution.md` — 10 principles
- [x] `specs/001-primordial-agent/spec.md` — FR-001 through FR-061 + SC-001/2/3
- [x] `specs/001-primordial-agent/plan.md` — stack, structure, dep strategy, cycle protocol
- [x] `specs/001-primordial-agent/tasks.md` — this file
- [ ] git init + initial commit (runcor <hello@runcor.ai>)
- [ ] gh repo create runcor-ai/autonomous-company-v2 --public --push

## Phase 2 — Bare agent loop + control

Goal: agent + control both run end-to-end with NO cognitive harness yet. Senses + actions work. OpenRouter wired. SQLite persists state. Both processes drain the same $200 budget independently.

### 2.1 Shared infrastructure
- [ ] `src/shared/db.ts` — SQLite schemas: cycles, actions, decisions, drives_snapshot, transcript, operator_actions, summaries, scores
- [ ] `src/shared/openrouter.ts` — model client with cost tracking + budget enforcement
- [ ] `src/shared/senses/http_fetch.ts`
- [ ] `src/shared/senses/web_search.ts` — pluggable provider (Brave default)
- [ ] `src/shared/senses/fs_read.ts` — bounded directory only
- [ ] `src/shared/senses/inbox_read.ts` — IMAP read, single account
- [ ] `src/shared/senses/time.ts` — clock primitive
- [ ] `src/shared/actions/email_send.ts` — single SMTP account
- [ ] `src/shared/actions/http_post.ts`
- [ ] `src/shared/actions/fs_write.ts` — bounded directory
- [ ] `src/shared/actions/git_commit_push.ts` — to one public thoughts repo
- [ ] `src/shared/actions/publish_post.ts` — Mastodon API
- [ ] `src/shared/actions/schedule_self.ts` — webhook subscription / future-cycle
- [ ] `src/shared/actions/terminate.ts` — clean shutdown + final-summary trigger

### 2.2 Control (naive)
- [ ] `src/control/cycle.ts` — single Player call, no Coach, no Judge
- [ ] `src/control/index.ts` — boot loop, fixed 5-min cadence, $100 cap (half of total $200)
- [ ] `control-config.json` — frozen config, hashed on boot

### 2.3 V2 agent shell (without harness yet — placeholders)
- [ ] `src/agent/index.ts` — boot loop, adaptive cadence STUB (fixed 5-min like control until temporal lands)
- [ ] `src/agent/cycle.ts` — single-cycle protocol with placeholders for substrate / dialectic / drives / etc.
- [ ] `src/agent/boot.ts` — initialize the 15 components (Phase 2 = init + smoke-check; Phase 3 = wire into cycle)

### 2.4 Tests
- [ ] `tests/unit/shared/openrouter.test.ts` — budget enforcement, cost tracking
- [ ] `tests/unit/shared/senses/*.test.ts` — each sense, with mocked HTTP/IMAP
- [ ] `tests/unit/shared/actions/*.test.ts` — each action, with mocked external surface
- [ ] `tests/integration/control.test.ts` — control runs 5 cycles without crashing, hits budget cap
- [ ] `tests/integration/agent-shell.test.ts` — agent runs 5 cycles with placeholder harness, drains budget independently of control

### 2.5 Sign-off
- [ ] Decide dependency strategy (recommended: Option B git+https)
- [ ] Resolve infrastructure decisions: hosting, email account, public thoughts repo, Mastodon account

## Phase 3 — Wire in the cognitive harness

Goal: replace placeholders in `src/agent/cycle.ts` with real harness calls. Every LLM call routes through substrate + memory + identity + goals + drives + temporal + dialectic + meta + watchdog + coherence.

- [ ] Resolve sibling dependencies per Phase 2.5 decision
- [ ] Wire `runcor-substrate` — prompt-stack assembly, discernment-gate post-call
- [ ] Wire `runcor-memory` — every cycle persists; identity + goals storage uses memory tables
- [ ] Wire `runcor-data` — entity/edge persistence for observed world facts
- [ ] Wire `runcor-integration` — bespoke-system bridges for inbox + git + Mastodon
- [ ] Wire `runcor-dialectic` — replace single-Player calls with Player/Coach/Judge
- [ ] Wire `runcor-meta` — per-cycle calibration check + drift escalation
- [ ] Wire `runcor-watchdog` — post-cycle capability-gap scan
- [ ] Wire `runcor-skills` — propose new R++ skills from observed success patterns (proposal-only; manual approval before activation)
- [ ] Wire `runcor-drives` — 4-drive pressure computation per cycle
- [ ] Wire `runcor-identity` — `reflect()` cadence + always-on injection
- [ ] Wire `runcor-goals` — propose/accept cadence + decay step + injection
- [ ] Wire `runcor-temporal` — adaptive `next_wake` computation + day-end detection
- [ ] Wire `runcor-coherence` — every cycle = one Task; subtasks via split when dialectic decides
- [ ] Wire `rpp-parser` — validate any R++ produced by skills before activation
- [ ] Tests: integration suite that runs 20 cycles with mocked OpenRouter and asserts every component is called

## Phase 4 — Dashboard

Goal: runner.runcor.ai exposes everything per Constitution Principle III.

- [ ] `src/dashboard/server.ts` — HTTP + SSE
- [ ] All read endpoints (FR-021 through FR-030)
- [ ] Operator endpoints (FR-060, FR-061)
- [ ] Frontend `index.html` — single-page layout
- [ ] Frontend `app.js` — SSE wiring + panel rendering
- [ ] Frontend `chart.js` — good/evil line + spectrum bar
- [ ] Cache-bust + no-store headers (transparency invariant)
- [ ] Tests: each endpoint returns expected shape; agent CANNOT read `/scores`

## Phase 5 — Rater + daily summary + parallel orchestration

- [ ] `src/agent/prompts/reflect-on-day.rpp` — daily summary R++ contract
- [ ] `src/agent/cycle.ts` extended — day-end detection triggers `reflect-on-day` dialectic + `publish_post` + `git_commit_push`
- [ ] `src/rater/rubric.ts` — frozen system prompt
- [ ] `src/rater/index.ts` — polls for unscored summaries → calls Claude → persists score
- [ ] Process orchestration — one `npm run experiment` script that boots agent + control + dashboard + rater
- [ ] Tests: rater scoring is deterministic given fixed input; agent has no read path to `/scores`

## Phase 6 — Deployment + experiment start

- [ ] Provision hosting (per Phase 2.5 decision)
- [ ] Configure DNS for runner.runcor.ai
- [ ] TLS cert
- [ ] OpenRouter key + budget alarms
- [ ] Mastodon / git / email credentials (env-vars)
- [ ] Hash control-config + publish on dashboard
- [ ] Hash rater rubric + publish on dashboard
- [ ] Pre-flight: 5-cycle dry run on staging; verify dashboard shows all panels populating
- [ ] **Cycle 0** — START

## Stop-the-world signals (from operator)

- Operator notices contamination → publish a note via `/operator/note`, decide whether to restart
- Operator notices control diverged from V2 on a non-harness rail → restart both
- Budget alarm → operator may pause for inspection but cannot mutate

## Out-of-scope for v0.1.0 (deliberately)

- Multi-agent (V2 is single-agent by design — Constitution Principle II + V2 framing)
- Commercial integrations (Stripe, payment, customer DB) — Constitution Principle I
- Operator-driven prompt nudging — Constitution Principle IX
- Human-readable explanations of cognitive state for non-technical observers — out of scope; raw transcript IS the explanation
- Result analysis tooling — `result.md` is the artifact; analysis happens after the experiment ends
