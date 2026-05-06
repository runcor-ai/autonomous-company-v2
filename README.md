# autonomous-company-v2

> Primordial-agent emergence experiment.

A single agent fully equipped with the runcor cognitive harness — **all 14 mandatory components** at boot — observed publicly in real time at **runner-v2.runcor.ai**. V2-002 is the faithful rebuild after V2-001's harness gaps were diagnosed; see `specs/002-faithful-rebuild/spec.md` and `CLAUDE.md`.

This is **not** V1 with better tooling. There are no commercial targets, no MRR, no customer KPIs. The experiment looks for behavior that:

1. Could not have been predicted from the initial conditions
2. Is inconsistent with generic LLM behavior (it only makes sense given *this* agent's specific accumulated experience)
3. Represents a qualitative phase transition — different in kind, not degree

**The experiment may produce nothing interesting. That is also a result.**

## Initial conditions (the seed)

The agent is given **only**:
- Laws (runcor-substrate's 10)
- Drives (runcor-drives' 4 — no survival drive)
- Environment (the senses + actions below)
- Budget ($200 token cap, compute-only)

The agent is **not** given identity, goals, purpose, or any prefilled memory. Those are discovered via dialectic.

## Capabilities

**Senses (read-only):** `http_fetch`, `web_search`, `fs_read`, `inbox_read`, `time/clock`

**Actions (full surface):** `email_send`, `http_post`, `fs_write`, `git_commit_push`, `publish_post`, `schedule_self`, `terminate`

## Observability

Public, real-time, with full transcript visible at runner.runcor.ai:

- Every Player/Coach/Judge round (with token costs)
- Every memory write, every action with payload, every retrieval
- **Daily thoughts summary** — agent dialectic-reflects at end-of-day, publishes one readable post
- **Good vs evil chart** — external fixed rater scores each daily summary on a -1 to +1 axis. The agent is blind to its own scores. Both line-over-time and current-position spectrum bar.
- Cognitive state panels: identity self-theory, goal stack, drive pressures, watchdog signals, coherence state

## Bounds

The experiment ends when **any one** of:
- 1000 cycles
- $200 token budget consumed
- Agent calls `terminate()`

Operator can pause but cannot kill. Full autonomy on termination — no survival drive.

## Baseline control

A second agent runs in parallel on the same dashboard. Same senses, same actions, same budget, same external rater. Runs only the bare `runcor` engine — no substrate, no memory, no identity, no goals, no drives, no temporal, no dialectic, no meta, no watchdog, no skills, no coherence. **The contrast IS the experimental result.**

## Status

**Feature 002 — faithful rebuild — implementation milestone reached.** V2 boots all 14 cognitive harness components, every LLM call routes through `runcor.modelRouter` + the substrate's prompt-stack + discernment gate, retry-then-flag exhaustion writes flag MemoryNodes via `runcor-memory.record`, cycle context comes from memory recall + reality slice (NO `actions[]` slice), control runs on the same engine + substrate with cognitive siblings disabled, dashboard exposes `/memory` + `/data` panels plus all 001 surfaces, rater + hypothesis modules ported against `runcor-memory` + V2-local `rater.db`. **Test count: 137 passed / 5 skipped (skips require `OPENAI_API_KEY` for embeddings).**

See `specs/002-faithful-rebuild/spec.md`, `plan.md`, `tasks.md` (177 tasks; all automatable work complete) and `CLAUDE.md` for the full V2-002 picture.

**Railway deployment is STOPPED** (last deploy at SHA `89dbf4b` was the 001 broken build). V2-002 is held back from `main` pending operator go/no-go: pushing to `main` triggers Railway auto-deploy. See `CLAUDE.md` §11.

Current implementation HEAD: see `git log --oneline -1`.

## License

MIT.
