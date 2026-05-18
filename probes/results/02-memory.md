# Probe #2 — runcor-memory

**Status:** MIXED (3 PASS, 2 FAIL) — but the failures point to structural gaps, not bugs.

**Ran:** 2026-05-18
**Inputs:** 50 realistic V2-shape episodic records
**Probe source:** `scripts/probe/02-memory.ts`

## Results

| Check | Result | Detail |
|---|---|---|
| Insert succeeds | PASS-ish | 34 created, 16 deduped, 0 errors. Aggressive dedup merged distinct events. |
| Recall accuracy | **PASS (8/8 = 100%)** | Every query found the right tagged node in top-3 |
| Forgetting fires | PASS | 13 nodes decayed below threshold across 15 cycles |
| Promotion to long cube | **FAIL (0 promotions)** | Default-R nodes can't reach M=0.6 threshold |
| Errors ≤ 10% | PASS | 0% errors |

## What works

- `query()` semantic recall is solid — found the right schema-success / schema-fail / decision / identity / discernment nodes for plain-English queries.
- `cycle()` correctly increments `t`, recalculates `M`, decays low-value nodes out.

## What's structurally broken

1. **`query()` doesn't reinforce `f`.** Reading a memory has no durability effect. Only re-recording similar content (which triggers dedup-reinforcement) bumps `f`.
2. **Promotion unreachable for default-R nodes.** With R=0.7, f=1, t=0, D≈0.5 → M≈0.49. Threshold is 0.6. Long cube stayed empty across 15 cycles.
3. **No public `reinforce(nodeId)`.** Nothing for the agent/side-effects pipeline to deliberately weight a memory.
4. **Dedup at 0.90 cosine may be too aggressive.** 32% of distinct events were merged. Could collapse "succeeded with commitMessage" + "failed without" into one node, losing the contrast.

## How this explains V2's schema-amnesia

It's not "MemoryRecallLayer never queries" — it's "by the time MemoryRecallLayer queries, the schema lesson is gone." Lessons happen once each, with moderate R, never promote, and decay out of the short cube within ~15 cycles.

## Recommended fixes for the Lattice build

- One-line: `query()` should `f += 1` on retrieved nodes
- Add: `reinforce(nodeId, amount?)` public method
- Tune: promotion threshold or default R distribution so important memories CAN promote
- Configurable: dedup similarity threshold (currently hardcoded 0.90)
