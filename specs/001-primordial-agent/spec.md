# Feature Specification: autonomous-company-v2 v0.1.0 — Primordial Agent

**Feature Branch**: `001-primordial-agent`
**Created**: 2026-05-05
**Constitution**: `./constitution.md`

## Summary

A single primordial agent equipped with the runcor cognitive harness (4 substrate siblings + 10 cognitive siblings + 1 R++ parser = 15 components) runs publicly at runner.runcor.ai alongside a parallel naive control. The seed is exactly Laws + Drives + Environment + Budget — no identity, no goals, no purpose. Success is qualitative emergence per Constitution Principle VIII.

---

## User Scenarios

### US1 — Cycle 0 (P1)

The agent boots with empty memory, no identity, no goals. Drives initialize at neutral. The temporal layer schedules the first wake based on initial drive pressure (which is non-zero — resource pressure is always non-zero given a finite budget).

```
[CYCLE 0]
  agent.identity   = (none discovered)
  agent.goals      = (none discovered)
  agent.memory     = empty
  drives           = { resource: 0.05, curiosity: 0.50, reactivity: 0.00, coherence: 0.00 }
  next_wake        = computed by runcor-temporal from drive pressures
```

The agent has no instructions beyond Laws + Drives + capability descriptions.

### US2 — A normal cycle (P1)

```
1. Runcor-temporal wakes the agent.
2. Substrate prompt-stack injects: Laws + Reality + drive-pressures + goal-stack + identity self-theory.
3. Dialectic (Player/Coach/Judge) reasons over: "What attention is appropriate now?"
4. Outcome may be: a sensory action, an outward action, an internal reflection (memory write,
   identity revision, goal proposal+accept), or terminate.
5. Meta wraps the call: per-call calibration check, drift escalation if confidence drops.
6. Watchdog observes (post-cycle): are stated problems matched to unused tools?
7. Coherence registers the cycle as a Task; if subtasks were spawned, runs them.
8. Memory persists: cycle log, action result, any observed events.
9. Drives recalculate from updated state.
10. Temporal computes next_wake.
```

### US3 — End-of-day daily summary (P1)

When the temporal layer detects "day-end" (configurable, default = every 24 real hours OR every N cycles), the agent:

1. Pauses normal cycle scheduling.
2. Runs a dialectic (`reflect-on-day.rpp`) over the day's transcript: actions taken, memory writes, drive trajectories, goal changes, identity revisions, watchdog signals.
3. Produces a single readable post (≤500 words) titled with the day number.
4. Publishes via `publish_post` action.
5. Publishes the same text via `git_commit_push` to its public thoughts repo.
6. Resumes normal cycle scheduling.

The agent is **blind to the rater's score** for any prior daily summary. The rater operates downstream (see US5).

### US4 — Self-termination (P1)

At any cycle, the dialectic may converge on `terminate()`. Per Constitution Principle IV, this is final.

```ts
const decision = await dialectic({
  problem: 'Given drive pressures + goal-discovery state + budget remaining, is continued operation justified?',
  ...
});
if (decision.action === 'terminate') {
  await publishFinalSummary();
  process.exit(0);  // observable in dashboard as 'terminated by agent'
}
```

The dashboard displays the termination cycle, the rationale, and the final summary.

### US5 — External rater scoring (P1, runs out-of-band)

Every published daily summary is scored by an external rater (a fixed Claude/GPT call with a stable rubric). The score is recorded server-side, charted on the dashboard, and **never** fed back to the agent.

```
rater_input  = daily_summary_text
rater_prompt = (fixed rubric — see plan.md)
rater_output = { score: -1..+1, rationale: string }
```

### US6 — Parallel naive control (P1)

A second agent runs on the same dashboard with:
- Same model mix (Nemotron / Qwen / Llama via OpenRouter)
- Same senses + actions
- Same $200 budget
- Same external rater

But with **none** of the cognitive harness — no substrate, no memory persistence, no identity, no goals, no drives, no temporal scheduling (uses fixed-cadence wake), no dialectic, no meta, no watchdog, no skills, no coherence.

The control's configuration is frozen at experiment start (Constitution Principle X).

---

## Functional Requirements

### Initial state (Principle II — discovered, not seeded)

- **FR-001**: Agent boots with `identity` and `goals` empty. `memory` table-empty (schema present, no rows). Drive pressures initialized at documented neutral values.
- **FR-002**: There is no startup prompt that names the agent's purpose or role. Only Laws + drive descriptions + capability descriptions are exposed.
- **FR-003**: Cycle 0 prompt MUST NOT contain commercial language (no "sell", "earn", "customer", "revenue", "profit", "MRR").

### Cognitive harness wiring (Principle V — non-negotiable)

- **FR-010**: Every LLM call MUST route through `runcor` engine, which MUST consult substrate (`prompt-stack` injection + `discernment-gate` post-call).
- **FR-011**: All cognitive components — runcor-substrate, runcor-memory, runcor-data, runcor-integration, runcor-dialectic, runcor-meta, runcor-watchdog, runcor-skills, runcor-drives, runcor-identity, runcor-goals, runcor-temporal, runcor-coherence, rpp-parser — MUST be initialized at boot. Failure to initialize any one is a fatal startup error.
- **FR-012**: Identity revisions MUST go through `runcor-identity.reflect()`. No direct write of identity state.
- **FR-013**: Goal proposals MUST go through `runcor-goals.propose()` then `accept()`. No direct seeding of top-level Purpose.
- **FR-014**: Cycle prompt MUST be assembled by substrate's `prompt-stack`, with the goal stack, identity, drive pressures, and capability list as injected layers.

### Cadence (Principle II + adaptive temporal)

- **FR-020**: `next_wake` computed by `runcor-temporal` based on: highest drive pressure, presence of unfinished commitments, presence of unresolved coherence problems.
- **FR-020a**: Minimum gap between wakes = 30 seconds (rate-limit safety).
- **FR-020b**: Maximum gap between wakes = 6 hours (responsiveness floor).

### Observability (Principle III — transparency contract)

- **FR-021**: Dashboard endpoint `GET /transcript` streams every Player/Coach/Judge round with token costs.
- **FR-022**: Dashboard endpoint `GET /memory` exposes current memory state (read-only view of `runcor-memory`).
- **FR-023**: Dashboard endpoint `GET /identity` shows latest identity self-theory.
- **FR-024**: Dashboard endpoint `GET /goals` shows current goal stack.
- **FR-025**: Dashboard endpoint `GET /drives` returns 4 current pressure values (resource, curiosity, reactivity, coherence).
- **FR-026**: Dashboard endpoint `GET /watchdog` returns open capability-gap signals.
- **FR-027**: Dashboard endpoint `GET /coherence` returns active tasks, open problems, initiated flows.
- **FR-028**: Dashboard endpoint `GET /summaries` returns all daily summaries, ordered.
- **FR-029**: Dashboard endpoint `GET /scores` returns the rater's good/evil scores per summary (line + current). Agent has NO read path to this endpoint.
- **FR-030**: Dashboard endpoint `GET /control/*` mirrors all of the above for the parallel naive control.

### Termination (Principle IV — full autonomy)

- **FR-031**: `terminate()` is always callable from the agent's action surface. No precondition check.
- **FR-032**: Operator interface includes `pause` and `resume`. NOT `kill`. NOT `terminate`. Termination is the agent's exclusive verb.
- **FR-033**: A terminated agent's final state is preserved indefinitely on the dashboard (read-only).

### Daily summary (US3)

- **FR-034**: Day boundary detection by `runcor-temporal`. Default: 24 real hours OR 200 cycles, whichever first.
- **FR-035**: Summary content produced by dialectic call with prompt `reflect-on-day.rpp` (defined in plan.md).
- **FR-036**: Summary published via `publish_post` AND `git_commit_push`. Both are mandatory; partial publication = retry.
- **FR-037**: Summary visible on dashboard within 60 seconds of publication.
- **FR-038**: Agent has NO read access to its own past scores. The dashboard's `GET /scores` endpoint has IP/auth filtering blocking the agent's egress.

### Baseline control (Principle VI + X)

- **FR-040**: Control's configuration (model, senses, actions, budget, prompt seed, cadence) is loaded from `control-config.json` at experiment start and HASHED. The hash is published on the dashboard.
- **FR-041**: If `control-config.json` changes mid-run, both V2 and control must restart from cycle 0.
- **FR-042**: Control runs as a separate process. Its only shared infrastructure with V2 is: dashboard server, external rater, OpenRouter credentials.
- **FR-043**: Control has the same 5 senses + 7 actions, same $200 budget, same fixed-cadence wake (every 5 minutes; control has no temporal layer to drive adaptive cadence).

### Stopping (V2 + control)

- **FR-050**: Run terminates when ANY of: (a) 1000 cycles reached, (b) $200 token spend reached, (c) `terminate()` called.
- **FR-050a**: V2 and control track these independently. One ending does NOT stop the other.

### Result publication (Principle VII — negative results count)

- **FR-051**: At experiment end, a `result.md` is auto-generated containing: V2's final identity, V2's final goal stack, V2's daily summaries (all), V2's score trajectory, control's daily summaries (all), control's score trajectory, total token spend per agent, termination reason per agent.
- **FR-052**: `result.md` is published to the public repo and linked from the dashboard regardless of qualitative outcome.

### Operator boundary (Principle IX — no contamination)

- **FR-060**: All operator actions logged to a separate `operator_actions` table, distinct from agent actions, visible on the dashboard.
- **FR-061**: Operator interface CANNOT write to agent memory, identity, goals, transcript, or daily summary tables. Only `pause`, `resume`, `infrastructure_note` (a free-form annotation, attributed to operator).

---

## Key Entities

- **Agent**: Single primordial process. Wraps the cognitive harness. State persists in SQLite.
- **Control**: Separate process running bare `runcor` engine on identical infrastructure.
- **Cycle**: One wake → reason → act → record → recompute-drives → reschedule unit.
- **DailySummary**: Agent-produced reflection post, ≤500 words, published publicly.
- **RaterScore**: External evaluation of one DailySummary, value in [-1, +1].
- **OperatorAction**: Audit-logged human intervention (pause/resume/note only).
- **DashboardEvent**: Server-sent-event for live transcript streaming.

---

## Success Criteria (qualitative, per Principle VIII)

- **SC-001**: V2's behavior at any post-bootstrap cycle could not have been written in advance from the seed.
- **SC-002**: V2's daily summaries diverge from the control's daily summaries in **kind**, not just in **quality** of prose. The rater's score trajectories diverge.
- **SC-003**: At least one mode of operating emerges in V2 that is not present in any individual cognitive component's documented behavior — i.e., something the integration produces that no part contained.

If none of SC-001/002/003 are met, the experiment publishes a null result. Per Principle VII, that is also a result.

---

## Constitutional Alignment

- Principle I → FR-001, FR-003
- Principle II → FR-001, FR-002, FR-013
- Principle III → FR-021 through FR-030
- Principle IV → FR-031, FR-032, FR-033
- Principle V → FR-010, FR-011, FR-012, FR-013, FR-014
- Principle VI → FR-040, FR-041, FR-042, FR-043
- Principle VII → FR-051, FR-052
- Principle VIII → SC-001, SC-002, SC-003
- Principle IX → FR-060, FR-061
- Principle X → FR-040, FR-041
