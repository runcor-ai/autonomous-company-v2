# Probe #2 — runcor-memory (BEFORE + AFTER Tier 3 fix)

## BEFORE fix (2026-05-17)

| Check | Value |
|---|---|
| Recall accuracy | 100% (8/8 — semantic recall solid) |
| Forgetting fires | YES (13/15 cycles forgot something) |
| Promotion to long cube | **0** across 15 cycles |
| Long cube final size | 0 |
| `query()` reinforces `f` | **NO** — only re-records (via dedup) bumped f |
| Public `reinforce(id)` | **MISSING** |
| Dedup threshold | hardcoded 0.90 cosine |

## ROOT CAUSE

`query()` reset `t` and updated `lastAccessed` but didn't bump `f`. With R=0.85 and f=1, M = 0.589 — below the 1.5 promotion threshold. Even after 8 recall hits, f stayed at 1, so M stayed at 0.589, and the node decayed out before it could ever promote.

Net effect for V2: schema-lessons couldn't survive long enough to be recalled when the agent was about to repeat the same broken tool call.

## AFTER fix (2026-05-18) — runcor-memory commit `c0258d8`

- `query()` bumps `f` by `config.recallReinforcement` (default 1) per retrieved node, recalculates M with new f, resets t
- New public `reinforce(id, amount=1)` method for explicit out-of-band weighting
- `MemoryConfig.dedupThreshold` (default 0.90 preserved)
- `MemoryConfig.recallReinforcement` (default 1; set 0 to disable)
- `config-loader` merges both new fields

| Check | Value |
|---|---|
| Recall accuracy | 100% (still) |
| Promotion to long cube | **2** (after 8 recall hits on schema-success nodes) |
| Long cube final | **2 schema-success memories** |
| Forgetting | 9 across 15 cycles (slightly fewer because the high-value ones promoted instead) |

## Cascade

The "schema-amnesia" pattern from V2 forensic (succeeded → failed → succeeded → failed at cycles 160/250/300/350) was caused by lessons aging out of short cube before being recalled again. With this fix, **recalling a lesson makes it MORE durable, not less.** That's the structural change that lets the harness actually learn from its own history.

## Implementation

- File: `runcor-memory/src/memory-system.ts` — query() and new reinforce() method
- File: `runcor-memory/src/types.ts` — MemoryConfig extended with dedupThreshold + recallReinforcement
- File: `runcor-memory/src/config-loader.ts` — merge new fields
- Commit: runcor-memory `c0258d8`
