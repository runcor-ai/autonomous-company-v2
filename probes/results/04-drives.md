# Probe #4 — runcor-drives

**Status:** COMPONENT PASS / V2 WIRING FAIL

**Ran:** 2026-05-18
**Probe source:** `scripts/probe/04-drives.ts`

## Verdict

`runcor-drives` is pure-function correct. **V2 silences half the drives** by passing hardcoded empty inputs.

## Component (PASS)

All 4 drive functions behave per spec:
- `resourcePressure({remaining, total, burnPerCycle, cyclesUsed})` — orders correctly across budget states (comfortable → cautious as runway shrinks)
- `curiosityPressure({exploredAreas, knownAreas, recentExplorationCycles})` — 0 when all known explored, rises with unexplored gap
- `reactivityPressure({pendingEvents})` — 0 on empty, 1.0 on critical event, multi-event accumulation, age amplification
- `coherencePressure({selfTheoryClaims, recentActions, knownMismatches})` — 0 on empty, rises with claim-action mismatch
- `computeDrives()` aggregates + picks dominant correctly

Empty inputs → 0 intensity for all four. Aging + accumulation curves work.

## V2 wiring bug

**`src/agent/cycle.ts` lines 149-166:**
```typescript
function captureDrivePressure(memory, args, currentCycle): DrivePressure {
  return computeDrives({
    resource: { remaining, total, burnPerCycle, cyclesUsed },
    curiosity: { exploredAreas, knownAreas, recentExplorationCycles },
    reactivity: { pendingEvents: [] },                            // ← ALWAYS EMPTY
    coherence: { selfTheoryClaims: [], recentActions: [] },       // ← ALWAYS EMPTY
  });
}
```

**Effect:** the agent's prompt-stack drive layer only ever sees resource + curiosity signals. Reactivity and coherence are permanently 0 in everything the agent perceives.

**Mismatch with dashboard:** `src/dashboard/server.ts` line 754 calls `computeDrives` with REAL reactivity events + real claims. So the operator sees one set of drives on the dashboard; the agent sees a different set in its prompt. Two sources of truth, only one (the wrong one) shapes behavior.

## V2 forensic re-examined

The forensic said *"Drives compute against memory tag count (monotonic), not outcome trajectory — can't push toward novelty when reactivity high."*

Actually the agent's reactivity is always 0 (hardcoded empty). The dashboard /drives showed 0.85 reactivity because the DASHBOARD construction path produces it from bus events. The agent never sees that signal. So the agent isn't "pushed toward defensive behavior by high reactivity" — the agent has NO reactivity signal at all in its prompt.

## Fix shape (V2)

```typescript
// cycle.ts captureDrivePressure should derive:
//   pendingEvents from bus events tagged as 'inbox_unread' / 'reply_pending' / 'flag_warning'
//   selfTheoryClaims from identity.current().claims
//   recentActions from buildRecentActions(args.bus, args.agentRole).records
```

Not a one-line fix like goals; needs ~15 lines to wire the real signals. But the component is ready to consume them.
