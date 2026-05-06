// Test env + temp-dir setup. Boot requires env vars; tests that exercise boot need them set.
// Real-service tests load .env via dotenv (operator's stance: real services preferred).
// Tests that don't need real services use minimal stubbed values to keep boot satisfied.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const REQUIRED_KEYS = [
  'OPENROUTER_API_KEY',
  'OPERATOR_AUTH_TOKEN',
];

const STUB_VALUES: Record<string, string> = {
  OPENROUTER_API_KEY: 'sk-or-test-stub-key',
  OPERATOR_AUTH_TOKEN: 'test-operator-token',
};

/** Load .env if present (real-service tests). Returns whether it was loaded. */
export function loadDotEnv(): boolean {
  const result = dotenvConfig();
  return !result.error;
}

/** Ensure required env vars are set — falls back to STUB_VALUES if absent. */
export function ensureRequiredEnv(): void {
  for (const key of REQUIRED_KEYS) {
    if (!process.env[key]) {
      process.env[key] = STUB_VALUES[key];
    }
  }
}

export interface TestStateDirs {
  agentStateDir: string;
  scratchpadDir: string;
  cleanup(): void;
}

/** Make a temp agent-state dir + scratchpad dir. Returns cleanup hook. */
export function makeTempStateDirs(): TestStateDirs {
  const dir = mkdtempSync(path.join(tmpdir(), 'v2-test-'));
  const scratchpad = path.join(dir, 'scratchpad');
  return {
    agentStateDir: dir,
    scratchpadDir: scratchpad,
    cleanup: (): void => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort.
      }
    },
  };
}

/** Set env to point at an isolated state dir for this test. Returns prior values. */
export function setStateDirEnv(dirs: TestStateDirs): { restore(): void } {
  const prior = {
    AGENT_STATE_DIR: process.env.AGENT_STATE_DIR,
    SCRATCHPAD_DIR: process.env.SCRATCHPAD_DIR,
  };
  process.env.AGENT_STATE_DIR = dirs.agentStateDir;
  process.env.SCRATCHPAD_DIR = dirs.scratchpadDir;
  return {
    restore: (): void => {
      if (prior.AGENT_STATE_DIR === undefined) delete process.env.AGENT_STATE_DIR;
      else process.env.AGENT_STATE_DIR = prior.AGENT_STATE_DIR;
      if (prior.SCRATCHPAD_DIR === undefined) delete process.env.SCRATCHPAD_DIR;
      else process.env.SCRATCHPAD_DIR = prior.SCRATCHPAD_DIR;
    },
  };
}
