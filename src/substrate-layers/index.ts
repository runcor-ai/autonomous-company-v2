// V2-side substrate prompt layers (6 of the 8 canonical layers — substrate provides 2).
//
// Substrate provides LawsLayer + RealityLayer; V2 provides DrivesLayer + GoalsLayer +
// IdentityLayer + WatchdogLayer + CapabilitiesLayer + MemoryRecallLayer. Registration order:
//   [LawsLayer, RealityLayer, DrivesLayer, GoalsLayer, IdentityLayer, WatchdogLayer, CapabilitiesLayer, MemoryRecallLayer]
//
// WatchdogLayer added 2026-05-18 (Tier 2 fix per probe #5): surfaces open watchdog findings
// into the prompt deterministically instead of relying on recall to incidentally match them.

export { V2RealityLayer } from './reality.js';
export { DrivesLayer } from './drives.js';
export { GoalsLayer } from './goals.js';
export { IdentityLayer } from './identity.js';
export { WatchdogLayer } from './watchdog.js';
export { CapabilitiesLayer } from './capabilities.js';
export { MemoryRecallLayer } from './memory-recall.js';
