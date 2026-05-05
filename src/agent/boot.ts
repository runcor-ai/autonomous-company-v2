// V2 agent boot — Phase 2 STUB.
// Phase 3 will replace these stubs with real harness wiring.
// Per Constitution Principle V (cognitive substrate non-negotiable),
// every component MUST be initialized at boot in Phase 3.

import type { Store } from '../shared/db.js';

export interface HarnessHandles {
  // Phase 3 will populate these with real instances of each sibling.
  // Phase 2 leaves them as marker properties so cycle.ts can detect "harness present".
  substrate: 'PHASE3_STUB';
  memory: 'PHASE3_STUB';
  data: 'PHASE3_STUB';
  integration: 'PHASE3_STUB';
  dialectic: 'PHASE3_STUB';
  meta: 'PHASE3_STUB';
  watchdog: 'PHASE3_STUB';
  skills: 'PHASE3_STUB';
  drives: 'PHASE3_STUB';
  identity: 'PHASE3_STUB';
  goals: 'PHASE3_STUB';
  temporal: 'PHASE3_STUB';
  coherence: 'PHASE3_STUB';
  rppParser: 'PHASE3_STUB';
}

export function bootHarness(store: Store): HarnessHandles {
  void store;
  return {
    substrate: 'PHASE3_STUB',
    memory: 'PHASE3_STUB',
    data: 'PHASE3_STUB',
    integration: 'PHASE3_STUB',
    dialectic: 'PHASE3_STUB',
    meta: 'PHASE3_STUB',
    watchdog: 'PHASE3_STUB',
    skills: 'PHASE3_STUB',
    drives: 'PHASE3_STUB',
    identity: 'PHASE3_STUB',
    goals: 'PHASE3_STUB',
    temporal: 'PHASE3_STUB',
    coherence: 'PHASE3_STUB',
    rppParser: 'PHASE3_STUB',
  };
}
