// V2 agent boot — Phase 3: real cognitive harness wiring.
// Per Constitution Principle V (cognitive substrate non-negotiable),
// every component MUST be initialized at boot. Failure to initialize
// any one is a fatal startup error.

import {
  computeDrives,
  renderPressureBlock,
  type DrivePressureInputs,
  type DrivePressure,
} from 'runcor-drives';
import { createIdentity, type Identity } from 'runcor-identity';
import { createGoals, type Goals } from 'runcor-goals';
import { createTemporal, type Temporal } from 'runcor-temporal';
import { createMeta, type Meta } from 'runcor-meta';
import { createWatchdog, type Watchdog } from 'runcor-watchdog';
import { createSkills, type Skills } from 'runcor-skills';
import { createCoherence, type Coherence } from 'runcor-coherence';
import { parse, validate } from 'rpp-parser';

/** Minimal contract every harness component agrees on for reasoning calls.
 *  Real dialectic returns more — cost + transcript — and we surface cost so the
 *  cycle-level decision record can write actual USD spent (not zero). */
export type DialecticLike = (config: { problem: string; maxRounds?: number }) => Promise<{
  answer: string;
  costUsd?: number;
  promptTokens?: number;
  completionTokens?: number;
}>;

export interface BootOptions {
  /** Caller-provided dialectic — runcor-dialectic in production, mock in tests. */
  dialectic: DialecticLike;
  /** Per-component DB paths. Defaults to in-memory (':memory:'). */
  dbPaths?: {
    identity?: string;
    goals?: string;
    temporal?: string;
    meta?: string;
    coherence?: string;
  };
}

export interface AgentHarness {
  drivesCompute: (inputs: DrivePressureInputs) => DrivePressure;
  drivesRender: (p: DrivePressure) => string;
  identity: Identity;
  goals: Goals;
  temporal: Temporal;
  meta: Meta;
  watchdog: Watchdog;
  skills: Skills;
  coherence: Coherence;
  rppParse: typeof parse;
  rppValidate: typeof validate;
  dialectic: DialecticLike;
}

export function bootHarness(options: BootOptions): AgentHarness {
  const dbPaths = options.dbPaths ?? {};
  const harness: AgentHarness = {
    drivesCompute: computeDrives,
    drivesRender: renderPressureBlock,
    identity: createIdentity({ dbPath: dbPaths.identity ?? ':memory:' }),
    goals: createGoals({ dbPath: dbPaths.goals ?? ':memory:' }),
    temporal: createTemporal({ dbPath: dbPaths.temporal ?? ':memory:' }),
    meta: createMeta({ dbPath: dbPaths.meta ?? ':memory:', dialectic: options.dialectic }),
    watchdog: createWatchdog({ dialectic: options.dialectic }),
    skills: createSkills({ dialectic: options.dialectic, parser: { parse, validate } }),
    coherence: createCoherence({ dbPath: dbPaths.coherence ?? ':memory:' }),
    rppParse: parse,
    rppValidate: validate,
    dialectic: options.dialectic,
  };

  // Wiring guard: every slot MUST be a defined value (Constitution Principle V).
  for (const k of Object.keys(harness) as Array<keyof AgentHarness>) {
    if (harness[k] === undefined || harness[k] === null) {
      throw new Error(`bootHarness: slot '${k}' failed to initialize`);
    }
  }
  return harness;
}

/** Close every component that owns a DB connection. */
export function closeHarness(h: AgentHarness): void {
  h.identity.close();
  h.goals.close();
  h.temporal.close();
  h.meta.close();
  h.coherence.close();
}
