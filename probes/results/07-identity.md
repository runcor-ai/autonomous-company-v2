# Probe #7 — runcor-identity

**Status:** FULL PASS — but blocked in practice by runcor-data upstream

**Ran:** 2026-05-18
**Probe source:** `scripts/probe/07-identity.ts`

## Verdict

Identity works correctly. V2 wires it correctly. **Both call paths are right.** What blocks identity reflection in V2 isn't identity or its wiring — it's that runcor-data (probe #1) can't populate the cube to ≥15 entities, so the readiness gate never releases.

## Component (PASS)

- `current()` returns the latest SelfTheory, O(1)
- `setTrait(name, value)` updates a quantitative trait without dialectic, creates a new version, clamps to [0,1]
- `reflect(input)` uses dialectic to update claims + traits, creates new version
- `history(limit)` returns prior snapshots newest-first
- `renderBlock()` produces a prompt-friendly multi-line block
- Repeated `reflect()` with identical dialectic output produces stable claims (converges)

## V2 wiring (PASS)

- `side-effects.ts` C3 calls `identity.reflect()` every 20 cycles
- Readiness gate: `MIN_DATA_ENTITIES_FOR_IDENTITY_REFLECT = 15`
- Cadence is sensible (frequent enough to evolve, sparse enough to be stable)

## Why V2's identity stayed v1

Cascading failure: runcor-data's pipeline fails (probe #1, 55% ingest failures, 0 edges, nonsense entities). Cube stays at <15 entities. Gate at `side-effects.ts:41` (`MIN_DATA_ENTITIES_FOR_IDENTITY_REFLECT = 15`) never releases. `identity.reflect()` never fires. Self-theory stays at v1 with empty claims forever.

**Fix path:** repair runcor-data. Identity unblocks automatically.

## Dependency chain so far

```
runcor-data (FAIL)
   └─→ cube doesn't populate
        └─→ readiness gates don't release
             ├─→ runcor-goals.propose never fires usefully
             └─→ runcor-identity.reflect never fires
                  └─→ self-theory stays empty
                       └─→ IdentityLayer renders empty in prompt-stack
                            └─→ agent has no persona-coherence signal in prompt
```

One root failure (data) cascades to 4+ downstream component dormancies.
