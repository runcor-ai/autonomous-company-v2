# Probe #3 — runcor-goals

**Status:** COMPONENT PASS / V2 WIRING FAIL

**Ran:** 2026-05-18
**Probe source:** `scripts/probe/03-goals.ts`

## Verdict

The `runcor-goals` component itself functions correctly. **V2 misuses it** by never calling `decayStep()`, which is why V2's goals appear "immortal."

## Component behaviour (all correct)

| API | Result |
|---|---|
| `accept(candidate, {currentCycle})` | Creates goal at intensity 1.0 with per-level decay cadence (purpose 60 / objective 14 / initiative 5) and retirement threshold (0.10 / 0.15 / 0.20). PASS. |
| `reinforce(id, {currentCycle, evidence?})` | Resets `lastReinforcedCycle`, bumps intensity by 30% of remaining headroom toward 1.0. PASS. |
| `decayStep(cycle)` | Auto-retires goals whose intensity falls below threshold. Returns `{activeBefore, retiredThisStep}`. PASS — 7 goals retired across 150 simulated cycles. |
| `stack(cycle)` + `renderBlock(cycle)` | Composes P/O/I view, identifies dominant goal, renders prompt-ready block. PASS. |

## Audit claim re-examined

The V2 forensic said *"runcor-goals.retire() does not exist; accepted goals are immortal."*

This was **half wrong**:
- `decayStep()` IS the retirement mechanism. The component supports it.
- BUT — V2's `side-effects.ts` never calls it. Confirmed via grep: zero matches for `decayStep(` in the entire V2 source. So in practice, V2's goals never decay → never retire → effectively immortal.

## V2 wiring bug

```typescript
// src/agent/side-effects.ts (C4 block, current state):
if (args.goals && dialecticLike && args.cycle > 0 && args.cycle % GOAL_PROPOSE_EVERY === 0 && goalsReadyToPropose) {
  const proposals = await args.goals.propose({...});
  for (const p of proposals.slice(0, 2)) {
    args.goals.accept(p, { currentCycle: args.cycle });
    // ← MISSING: should also call args.goals.decayStep(args.cycle) every cycle
  }
}
```

Fix: call `args.goals.decayStep(args.cycle)` every cycle (not just on propose-cadence cycles). Goals decay continuously; retirement check should fire every cycle.

## Secondary risk: no dedup on text

`accept({text: 'push X', ...})` called 4 times with identical text → 4 distinct goal IDs. The V2 forensic showed the agent's "push data_processor.py" goal active from cycle 339 to 446 — that was likely several distinct duplicate accepts compounding the immortal effect.

Not catastrophic, but worth a future check: `accept()` could optionally dedup on text or near-text similarity.
