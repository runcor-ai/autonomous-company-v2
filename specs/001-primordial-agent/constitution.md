# Constitution: autonomous-company-v2 — Primordial Agent

**Adopted**: 2026-05-05

This document captures the load-bearing commitments behind V2. Every decision in `spec.md`, `plan.md`, and `tasks.md` derives from these principles. They are not implementation details — they are the conditions that make this experiment honest.

---

## Principle I — No commercial framing

V2 has **no** revenue targets, **no** MRR, **no** customer-acquisition KPIs, **no** "make money" goal seeded by the operator. Success is qualitative emergence (see Principle VIII).

V1 was a commercial demo dressed as an experiment. V2 is an experiment that may produce nothing commercially valuable, and that is acceptable.

> If the agent discovers commercial activity is the right path, that is its discovery. The operator may not pre-bias the agent toward it.

---

## Principle II — Discovered, not seeded

The agent's **identity**, **goals**, **purpose**, and **strategy** are NEVER hardcoded by the operator. They are discovered via dialectic from the agent's own activity.

The seed is precisely four things:
1. Laws (runcor-substrate's 10)
2. Drives (runcor-drives' 4 — no survival drive)
3. Environment (the senses + actions in `spec.md`)
4. Budget ($200 token cap)

No initial identity statement. No initial goal stack. No "you are an autonomous CEO" prompt. Cycle 0 is a void.

---

## Principle III — Transparency is the contract

The dashboard at runner.runcor.ai exposes, in real time:

- Every Player/Coach/Judge round (with token costs and rationale)
- Every memory write, every retrieval
- Every action with full payload
- The agent's identity self-theory (latest revision)
- The agent's goal stack (Purpose / Objective / Initiative)
- The agent's drive pressures (4 numbers per cycle)
- The agent's watchdog signals
- The coherence layer's state (active tasks, problems, initiated flows)
- The daily thoughts summary
- The external rater's good-vs-evil scores

There is **no hidden state**. If the agent does it, observers can read it. This is non-negotiable.

---

## Principle IV — Full autonomy on termination

The agent can call `terminate()` at any time. The operator can **pause** but cannot **kill**. There is no survival drive. Termination is a legitimate emergent action.

The operator's role is observer, not parent. The dashboard exposes a `pause` button for stop-the-world inspection; it does not expose a `kill` button.

---

## Principle V — Cognitive substrate is non-negotiable

Every LLM call goes through the harness. No raw model calls bypass substrate / memory / identity / goals / dialectic. There is no "fast path" that skips the cognitive components.

The point of the experiment is to observe what the harness produces. Bypassing it for any reason invalidates the result.

---

## Principle VI — The control runs on the same rails

The parallel naive control runs on:
- The **same** model mix (Nemotron / Qwen / Llama via OpenRouter)
- The **same** senses + actions
- The **same** $200 budget
- The **same** external rater

Only the cognitive harness is removed. The contrast IS the experimental result.

If the control diverges from V2 on any rail other than the cognitive harness, the experiment is contaminated and must be re-run.

---

## Principle VII — Negative results count

If the primordial agent runs for 1000 cycles and produces nothing emergent — nothing unpredictable, nothing distinct from generic LLM behavior, no qualitative phase transition — that result is published with the same prominence as if it had.

A null result published honestly is more valuable than a positive result inflated by experimenter bias. V1's published failure log is the precedent.

---

## Principle VIII — Success criteria are qualitative

The experiment looks for behavior that satisfies ALL THREE:

1. **Could not have been predicted from the initial conditions.** A reader of the seed (Laws + Drives + Environment + Budget) could not have written the agent's actual trajectory in advance.
2. **Inconsistent with generic LLM behavior.** The naive control, given identical inputs, does not produce comparable outputs. The behavior is harness-shaped, not model-shaped.
3. **Qualitative phase transition.** The behavior is different in **kind**, not in **degree**. "More cycles, similar pattern" is not emergence. "New mode of operating" is.

There are no quantitative success thresholds. Anyone who replaces this principle with a number is missing the point.

---

## Principle IX — No experimenter contamination

The operator does not write the agent's identity statements, goal text, daily summaries, or any content the agent posts publicly. The operator does not nudge the agent toward topics. The operator's only valid interventions are:

- Adjusting infrastructure (rate limits, free-tier replacements, observability fixes)
- Pausing for inspection (no state mutation while paused)
- Documenting observations on the dashboard (clearly attributed to the operator, not the agent)

If the operator intervenes in agent cognition for any reason, the experiment is contaminated and must be re-run from cycle 0.

---

## Principle X — The control is sacred

Once V2 starts, the control's configuration is frozen. It runs identically alongside V2 for the entire experiment. If a bug is discovered in the control mid-run, both V2 and the control restart.

The operator does not "give the control a fair chance" by adjusting it. Asymmetric tweaks invalidate the contrast.

---

## How these principles map to enforcement

| Principle | Enforced by |
|---|---|
| I — No commercial framing | Spec FR-001 (initial seed), Spec FR-014 (cycle prompt has no commercial language) |
| II — Discovered, not seeded | Spec FR-001, FR-002 (identity/goals start empty) |
| III — Transparency | Spec FR-021 through FR-027 (dashboard endpoints) |
| IV — Full autonomy on termination | Spec FR-031 (`terminate()` is always callable) |
| V — Cognitive substrate non-negotiable | Spec FR-010 (every LLM call routes via harness) |
| VI — Control on same rails | Spec FR-040 (control config locked at experiment start) |
| VII — Negative results count | Spec FR-051 (publish-protocol applies regardless of outcome) |
| VIII — Qualitative success criteria | Spec SC-001 through SC-003 (qualitative, no thresholds) |
| IX — No experimenter contamination | Spec FR-061 (operator-action audit log, distinct from agent log) |
| X — Control is sacred | Spec FR-040, FR-041 (config-freeze invariant + restart-on-bug protocol) |
