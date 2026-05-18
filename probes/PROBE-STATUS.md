# Probe status

Probe-first validation of the 14 runcor components + 1 knowledge-source bootstrap, before any Lattice rebuild work.

**Last updated:** 2026-05-18

## Status

| # | Component | Status | Verdict |
|---|---|---|---|
| 1 | runcor-data | DONE | **FAIL** — 9/20 entities, 0 edges, 55% pipeline failures, nonsense entity types |
| 2 | runcor-memory | DONE | **MIXED** — recall works, decay works; promotion unreachable, no reinforce primitive, dedup over-aggressive |
| 3 | runcor-goals | NEXT | — |
| 4 | runcor-drives | pending | — |
| 5 | runcor-watchdog | pending | — |
| 6 | runcor-substrate | pending | — |
| 7 | runcor-identity | pending | — |
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

## What's emerging

After 2 probes, a pattern is forming. The components don't catastrophically fail — they MOSTLY work mechanically. But they have **subtle structural gaps** that compound when wired together:

- **runcor-data** populates a cube but with malformed entity types and no edges → readiness gates never release
- **runcor-memory** recalls correctly but lessons can't survive long enough to be recalled later → schema-amnesia

Both broken in different ways that explain different V2 failures. Neither is "the component doesn't work" — both are "the component's defaults don't match V2's usage pattern."

The Lattice rebuild won't fix V2 by reorganizing the layers. It needs targeted fixes inside the components themselves, OR replacement of the worst offenders (probably runcor-data's pipeline first).
