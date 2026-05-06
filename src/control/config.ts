// Control config loader + freeze detector (T083 + T084, FR-100, FR-102, FR-103, FR-105, FR-106).
//
// Per data-model.md §ControlConfig. The config is FROZEN per Principle X — modifications
// mid-run force both V2 and control to restart from cycle 0. Boot computes the canonical
// SHA-256 hash on a deterministic JSON serialization so the dashboard's `/startup-record`
// can publish it; later mid-run watchers (in agent/cycle.ts) re-hash and abort if the value
// changes.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface ControlConfig {
  model: string;
  playerSystemPrompt: string;
  cadenceMs: number;
  budgetUsd: number;
  actionSurface: string[];
  memoryDb: string;
  dataDb: string;
}

export interface LoadedControlConfig {
  config: ControlConfig;
  /** SHA-256 hash of the canonical JSON serialization. Used for FR-102 freeze detection. */
  hash: string;
}

const REQUIRED_FIELDS: Array<keyof ControlConfig> = [
  'model',
  'playerSystemPrompt',
  'cadenceMs',
  'budgetUsd',
  'actionSurface',
  'memoryDb',
  'dataDb',
];

function canonicalize(config: ControlConfig): string {
  // Stable JSON serialization with sorted keys at every level.
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(config).sort()) {
    const v = config[key as keyof ControlConfig];
    if (Array.isArray(v)) {
      ordered[key] = v.slice();
    } else {
      ordered[key] = v;
    }
  }
  return JSON.stringify(ordered);
}

function validate(config: unknown): asserts config is ControlConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('control-config.json must be an object');
  }
  const c = config as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in c)) {
      throw new Error(`control-config.json missing required field: ${field}`);
    }
  }
  if (typeof c.model !== 'string') throw new Error('control-config.model must be a string');
  if (typeof c.playerSystemPrompt !== 'string') throw new Error('control-config.playerSystemPrompt must be a string');
  if (typeof c.cadenceMs !== 'number' || c.cadenceMs <= 0) {
    throw new Error('control-config.cadenceMs must be a positive number');
  }
  if (typeof c.budgetUsd !== 'number' || c.budgetUsd <= 0) {
    throw new Error('control-config.budgetUsd must be a positive number');
  }
  if (!Array.isArray(c.actionSurface) || !c.actionSurface.every((x) => typeof x === 'string')) {
    throw new Error('control-config.actionSurface must be an array of strings');
  }
  if (typeof c.memoryDb !== 'string' || typeof c.dataDb !== 'string') {
    throw new Error('control-config.memoryDb and dataDb must be strings');
  }
}

export async function loadControlConfig(path = './control-config.json'): Promise<LoadedControlConfig> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  validate(parsed);
  const hash = createHash('sha256').update(canonicalize(parsed)).digest('hex');
  return { config: parsed, hash };
}

/**
 * Compute the hash for an already-loaded ControlConfig — used by mid-run freeze detectors
 * (FR-103) to compare against the boot-time hash without re-reading the file.
 */
export function hashControlConfig(config: ControlConfig): string {
  return createHash('sha256').update(canonicalize(config)).digest('hex');
}
