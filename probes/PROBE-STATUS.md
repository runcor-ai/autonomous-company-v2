# Probe status

Probe-first validation of the 14 runcor components + 1 knowledge-source bootstrap, before any Lattice rebuild work.

**Last updated:** 2026-05-18

## Status

| # | Component | Status | Verdict |
|---|---|---|---|
| 1 | runcor-data | DONE | **FAIL** — 9/20 entities, 0 edges, 55% pipeline failures, nonsense entity types |
| 2 | runcor-memory | DONE | **MIXED** — recall works, decay works; promotion unreachable, no reinforce primitive, dedup over-aggressive |
| 3 | runcor-goals | DONE | **COMPONENT PASS / V2 WIRING FAIL** — decayStep exists and works; V2 never calls it (one-line fix) |
| 4 | runcor-drives | DONE | **COMPONENT PASS / V2 WIRING FAIL** — all 4 drive functions work; V2 hardcodes empty inputs for reactivity + coherence → agent always sees 0 for half the drives |
| 5 | runcor-watchdog | DONE | **COMPONENT PASS / V2 STEERING GAP** — matchers work; V2 writes findings to memory but has no WatchdogLayer → findings only reach agent by recall accident |
| 6 | runcor-substrate | DONE | **FULL PASS** — PromptStack assembles correctly, discernment gate blocks ungrounded outputs, V2 installs the monkey-patch + registers all 7 layers |
| 7 | runcor-identity | NEXT | — |
| 8 | runcor-dialectic | pending | — |
| 9 | runcor-temporal | pending | — |
| 10 | runcor-skills | pending | — |
| 11 | runcor-meta | pending | — |
| 12 | runcor-integration | pending (PROMOTED — critical for MCP coord + knowledge sources) | — |
| 13 | runcor-coherence | pending | — |
| 14 | runcor (engine) | pending | — |
| 15 | knowledge-source bootstrap | pending | — |

## Result files

- [01 — runcor-data](results/01-data.md) — TBD writeup
- [02 — runcor-memory](results/02-memory.md)
- [03 — runcor-goals](results/03-goals.md)
- [04 — runcor-drives](results/04-drives.md)
- [05 — runcor-watchdog](results/05-watchdog.md)
- [06 — runcor-substrate](results/06-substrate.md)

## What's emerging

After 3 probes, three distinct failure categories surfacing:

1. **Component-internal bugs** (probe #1, runcor-data): pipeline produces nonsense entity types, zero edges, 55% failure rate. Needs rewrite at the component level.

2. **Component design gaps** (probe #2, runcor-memory): mechanically works but defaults don't match V2's usage. Recall doesn't reinforce frequency; promotion threshold unreachable for default-R; no explicit reinforce primitive. Needs design changes inside the component.

3. **V2 wiring bugs** (probe #3, runcor-goals): component is correct, V2 fails to use it. `decayStep()` exists but V2 never calls it → goals immortal. One-line fix in V2.

These need different responses:
- Category 1 → rewrite the component
- Category 2 → tune the component's defaults / add missing APIs
- Category 3 → fix V2's side-effects pipeline

The Lattice rebuild needs to address all three, not assume they're the same problem.
