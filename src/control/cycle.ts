// Naive control cycle (T111) — re-exports the shared cycle loop from agent/cycle.ts.
//
// Per FR-101, the control's per-cycle behavior is the SAME loop as V2's, only with the
// cognitive components passed as null. Sharing the loop ensures Principle VI ("same rails"):
// any drift in cycle.ts automatically applies to both V2 and control.

export { runCycles } from '../agent/cycle.js';
export type { CycleStatus, CycleRecord, RunCyclesArgs } from '../agent/cycle.js';
