# Probe status

Probe-first validation of the 14 runcor components + 1 knowledge-source bootstrap, before any Lattice rebuild work.

**Last updated:** 2026-05-18

## Status

| # | Component | Status | Verdict |
|---|---|---|---|
| 1 | runcor-data | **FIXED 2026-05-18** | Was: FAIL (9/20 entities, 0 edges, 55% failure). After Tier 1 V2-action extractor: 49 entities, 36 edges, 0% failure, ~3ms/ingest, both readiness gates OPEN. See [01-data.md](results/01-data.md). |
| 2 | runcor-memory | **FIXED 2026-05-18** | Was: MIXED (0 promotions, no reinforce API, fixed dedup). After Tier 3: query() bumps f, public reinforce(), configurable thresholds. Re-run: 0→2 promotions, schema-success memories now survive recall. |
| 3 | runcor-goals | DONE | **COMPONENT PASS / V2 WIRING FAIL** — decayStep exists and works; V2 never calls it (one-line fix) |
| 4 | runcor-drives | DONE | **COMPONENT PASS / V2 WIRING FAIL** — all 4 drive functions work; V2 hardcodes empty inputs for reactivity + coherence → agent always sees 0 for half the drives |
| 5 | runcor-watchdog | DONE | **COMPONENT PASS / V2 STEERING GAP** — matchers work; V2 writes findings to memory but has no WatchdogLayer → findings only reach agent by recall accident |
| 6 | runcor-substrate | DONE | **FULL PASS** — PromptStack assembles correctly, discernment gate blocks ungrounded outputs, V2 installs the monkey-patch + registers all 7 layers |
| 7 | runcor-identity | DONE | **FULL PASS** — works + V2 wires correctly; "stayed v1" is upstream blocked by runcor-data not populating cube to gate threshold |
| 8 | runcor-dialectic | DONE | **FULL PASS** — Player(nemotron-120b)/Coach(qwen3-32b)/Judge(llama-8b) all fire; V2 wires correctly to identity + goals |
| 9 | runcor-temporal | DONE | **FULL PASS** — computeNextWake + isDayBoundary work; V2 uses both |
| 10 | runcor-skills | DONE | **FULL PASS** — proposeSkill returns R++ + confidence; V2 wires (every 50 cycles) |
| 11 | runcor-meta | DONE | **COMPONENT OK / V2 NEVER USES IT** — listed in boot guard but 0 imports/0 constructs/0 calls in V2 source |
| 12 | runcor-integration | DONE | **COMPONENT PASS / DORMANT IN V2** — works + V2 wires the calls, but agent never passes reachableSources. Critical wiring gap for the Lattice design (knowledge sources + MCP peer discovery both depend on this). |
| 13 | runcor-coherence | DONE | **COMPONENT PASS / V2 READ-ONLY** — full API exists; V2 only reads via dashboard; cycle loop never submits tasks → registeredEngines stays 0 |
| 14 | runcor (engine) | DONE | **FULL PASS** — all core methods present, cost telemetry fires, flows register and trigger |
| 15 | knowledge-source bootstrap | DONE | **PRIMITIVES READY / LATTICE WIRING REQUIRED** — engine+integration APIs all there; LatticeConfig.knowledgeSources field + boot-time MCP adapter registration is what's missing |

## Result files

- [01 — runcor-data](results/01-data.md) — TBD writeup
- [02 — runcor-memory](results/02-memory.md)
- [03 — runcor-goals](results/03-goals.md)
- [04 — runcor-drives](results/04-drives.md)
- [05 — runcor-watchdog](results/05-watchdog.md)
- [06 — runcor-substrate](results/06-substrate.md)
- [07 — runcor-identity](results/07-identity.md)
- [08 — runcor-dialectic](results/08-dialectic.md)
- [09 — runcor-temporal](results/09-temporal.md)
- [10 — runcor-skills](results/10-skills.md)
- [11 — runcor-meta](results/11-meta.md)
- [12 — runcor-integration](results/12-integration.md)
- [13 — runcor-coherence](results/13-coherence.md)
- [14 — runcor (engine)](results/14-engine.md)
- [15 — knowledge-source bootstrap readiness](results/15-knowledge-bootstrap.md)

## ALL 15 PROBES COMPLETE — punch list

| Component | Status | Category | Fix shape |
|---|---|---|---|
| 1 runcor-data | **FAIL** | Component-internal bug | Pipeline rewrite — 55% ingest failure, 0 edges, nonsense entity types |
| 2 runcor-memory | MIXED | Design gap | `query()` should bump `f`; add `reinforce()` public; tune promotion threshold or default R; configurable dedup |
| 3 runcor-goals | COMPONENT PASS / V2 WIRING FAIL | V2 wiring | One-line: call `goals.decayStep(cycle)` every cycle in side-effects.ts |
| 4 runcor-drives | COMPONENT PASS / V2 WIRING FAIL | V2 wiring | ~15 lines: wire real reactivity (bus events) + coherence (identity claims + actions) into `captureDrivePressure` |
| 5 runcor-watchdog | COMPONENT PASS / V2 STEERING GAP | V2 wiring | Add `WatchdogLayer` to prompt-stack so findings deterministically reach the next prompt |
| 6 runcor-substrate | **FULL PASS** | — | none |
| 7 runcor-identity | **FULL PASS** | (blocked upstream by #1) | none — fixes when #1 fixes |
| 8 runcor-dialectic | **FULL PASS** | — | none |
| 9 runcor-temporal | **FULL PASS** | — | none |
| 10 runcor-skills | **FULL PASS** | — | none (parser peer-dep is optional but improves confidence) |
| 11 runcor-meta | COMPONENT OK / V2 NEVER USES | Drop or wire | Either remove from required-14 OR add MetaLayer + recordTrajectory calls |
| 12 runcor-integration | COMPONENT PASS / DORMANT IN V2 | Lattice wiring | Critical — Lattice boot must pass `reachableSources` from harness knowledge bundle |
| 13 runcor-coherence | COMPONENT PASS / V2 READ-ONLY | Drop or wire | Same as meta — drop or wire `submit/route/parallel` into cycle |
| 14 runcor (engine) | **FULL PASS** | — | none |
| 15 knowledge-source bootstrap | PRIMITIVES READY | Lattice design work | Write `LatticeConfig.knowledgeSources` + boot adapter registration |

## Pattern across the 15

| Category | Count | Notes |
|---|---|---|
| **Full pass** | 5 | substrate, identity, dialectic, temporal, skills, engine — solid |
| **Mixed / design gap** | 1 | memory — works but defaults are wrong for V2's usage |
| **V2 wiring fail (component works)** | 3 | goals, drives, watchdog — fixable in V2 source |
| **Component dormant in V2** | 3 | meta (never used), coherence (read-only), integration (no sources) |
| **Component-internal bug** | 1 | data — needs pipeline rewrite |
| **Lattice readiness** | 1 | knowledge-source bootstrap — design work, no probe failure |

## The actual surgery the Lattice rebuild needs

**Tier 1 — must fix (blocks everything else):**
1. ✅ DONE 2026-05-18 — Rewrote runcor-data's ingest with code-first V2-action extractor. 9→49 entities, 0→36 edges, 55%→0% failure, 30-152s→3ms. Both readiness gates now OPEN. runcor-data commit `899701b`.

**Tier 2 — small V2/Lattice wiring fixes (load-bearing for the harness):**
2. ✅ DONE 2026-05-18 — `goals.decayStep(cycle)` in side-effects C4a (probe #3)
3. ✅ DONE 2026-05-18 — Real reactivity + coherence inputs in `captureDrivePressure` from bus events + identity (probe #4)
4. ✅ DONE 2026-05-18 — `WatchdogLayer` in prompt-stack between Identity + Capabilities (probe #5)
5. DEFERRED — Pass `LatticeConfig.knowledgeSources` as `reachableSources` to boot (probes #12 + #15) — requires LatticeConfig to exist; will land in the Lattice rebuild itself

**Tier 3 — component design improvements (memory in particular):**
6. ✅ DONE 2026-05-18 — runcor-memory `c0258d8`: `query()` bumps `f` per recall, public `reinforce(id, amount)`, configurable `dedupThreshold` + `recallReinforcement`. Probe #2 re-run: 0 promotions → 2 promotions; long cube 0 → 2 (both schema-success memories). Lessons survive recall.

**Tier 4 — wire meta + coherence (operator chose WIRE 2026-05-18):**
7. ✅ DONE 2026-05-18 — `MetaPressureLayer` in prompt-stack + per-cycle `meta.recordTrajectory` from cycle_record events + `meta.on('escalation')` → bus event. Meta now tracks trajectory quality + emits drift alerts. Standalone probe `scripts/probe/integration-tier-4.ts`: 9/9 PASS at $0 cost.
8. ✅ DONE 2026-05-18 — `CoherenceProblemLayer` in prompt-stack + periodic `coherence.detect()` every 5 cycles in side-effects C5b. Contradictions in accumulated state surface to the agent. Verified in same probe.

### Dialectic Judge 400 regression (2026-05-18) — RESOLVED
Root cause: stale local `dist/` in runcor-dialectic. Source had the parseModel-wrapper fix committed as `b6293d4`, but `dist/index.js` (built from an earlier revision) still passed raw `judgeCfg.model` to checkIncorporation/checkNovelty. V2 reads the sibling via `file:../runcor-dialectic` symlink, so it got the stale bytes. Fixed by `npm run build` in the runcor-dialectic repo. Verified by `scripts/probe/dialectic-judge-repro.ts` — canonical-topology dialectic with maxRounds=3 succeeds. Lesson: rebuild every modified sibling before running V2's cycle loop; prefer probe-style verification.

Prompt stack grew from 7 → 10 layers when fully populated:
laws → (seed?) → temporal → reality → drives → meta_pressure → goals → identity → watchdog → coherence_problems → capabilities → memory_recall

After tier 1+2 are done, the upstream cascade unblocks identity reflection, goals proposal, drive signaling, and watchdog steering automatically.

**This is much smaller than expected.** Most of the work is wiring, not rewriting.
