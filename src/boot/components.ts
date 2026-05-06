// Canonical 14-component registry (FR-011).
//
// V2's boot guard checks every entry in CANONICAL_COMPONENTS — failure to import / instantiate /
// health-check ANY one is a fatal startup error. The list is the experimental contract: the
// 14 components ARE the runcor cognitive harness. See spec FR-011 for the full text.
//
// Adding or removing entries here is a constitutional change (Principle V). Don't edit without
// updating spec.md FR-011 + plan.md + research.md in lockstep.

export const CANONICAL_COMPONENTS = [
  'runcor',
  'runcor-substrate',
  'runcor-memory',
  'runcor-data',
  'runcor-integration',
  'runcor-dialectic',
  'runcor-meta',
  'runcor-watchdog',
  'runcor-skills',
  'runcor-drives',
  'runcor-identity',
  'runcor-goals',
  'runcor-temporal',
  'runcor-coherence',
] as const;

export type CanonicalComponentName = (typeof CANONICAL_COMPONENTS)[number];

export const CANONICAL_COMPONENT_COUNT = CANONICAL_COMPONENTS.length; // 14
