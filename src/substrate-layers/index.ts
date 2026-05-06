// V2-side substrate prompt layers (5 of the 7 canonical layers).
//
// Substrate provides LawsLayer + RealityLayer; V2 provides DrivesLayer + GoalsLayer +
// IdentityLayer + CapabilitiesLayer + MemoryRecallLayer. Layer registration order is fixed
// by contracts/prompt-stack-layers.md and enforced at boot:
//   [LawsLayer, RealityLayer, DrivesLayer, GoalsLayer, IdentityLayer, CapabilitiesLayer, MemoryRecallLayer]

export { V2RealityLayer } from './reality.js';
export { DrivesLayer } from './drives.js';
export { GoalsLayer } from './goals.js';
export { IdentityLayer } from './identity.js';
export { CapabilitiesLayer } from './capabilities.js';
export { MemoryRecallLayer } from './memory-recall.js';
