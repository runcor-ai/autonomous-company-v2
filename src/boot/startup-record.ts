// StartupRecord builder (T054, FR-011a, FR-102).
//
// Captures the boot configuration: 14 components + their pinned versions + health-check
// pass/fail per component + the control-config hash + the substrate-installer-engaged flag.
// Published to the dashboard `/startup-record` endpoint and to a memory node tagged
// `['startup_record']` for forensics.
//
// The record's contract is data-model.md §StartupRecord. Versions are read from each
// sibling's `package.json` via Node's package resolution; we do NOT shell out to npm or
// parse our own package.json — the resolved-from-disk version is what's actually loaded.

import { createRequire } from 'node:module';
import { CANONICAL_COMPONENTS, type CanonicalComponentName } from './components.js';

const require = createRequire(import.meta.url);

export interface StartupComponent {
  name: CanonicalComponentName;
  pinnedVersion: string;
  healthCheck: 'pass' | 'fail';
  failureReason?: string;
}

export interface StartupRecord {
  bootedAt: number;
  agentRole: 'v2' | 'control';
  components: StartupComponent[];
  controlConfigHash?: string;
  envSummary: {
    hasOpenRouterKey: boolean;
    hasOperatorAuthToken: boolean;
    hasFirecrawlKey: boolean;
    hasRunnerEmail: boolean;
    hasGitPushCreds: boolean;
  };
  substrateInstallerEngaged: boolean;
}

/**
 * Read a sibling package's version from its installed package.json. Returns `'unknown'` if
 * the package can't be resolved — this should NEVER happen at boot if the package.json deps
 * are intact, so an `unknown` here is a strong signal that something is broken.
 */
function readPinnedVersion(pkg: CanonicalComponentName): string {
  try {
    const meta = require(`${pkg}/package.json`) as { version?: string };
    return typeof meta.version === 'string' ? meta.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface BuildStartupRecordArgs {
  agentRole: 'v2' | 'control';
  controlConfigHash?: string;
  envSummary: StartupRecord['envSummary'];
  substrateInstallerEngaged: boolean;
  /**
   * Component health overrides. If the boot's component-init step caught an error for a
   * given component, the caller passes `{ [name]: 'fail', reason: '...' }` here.
   * Components not present in this map are reported as 'pass'.
   */
  componentHealth?: Partial<Record<CanonicalComponentName, { status: 'pass' | 'fail'; reason?: string }>>;
}

export function buildStartupRecord(args: BuildStartupRecordArgs): StartupRecord {
  const components: StartupComponent[] = CANONICAL_COMPONENTS.map((name) => {
    const health = args.componentHealth?.[name];
    return {
      name,
      pinnedVersion: readPinnedVersion(name),
      healthCheck: health?.status ?? 'pass',
      ...(health?.reason ? { failureReason: health.reason } : {}),
    };
  });

  return {
    bootedAt: Date.now(),
    agentRole: args.agentRole,
    components,
    ...(args.controlConfigHash ? { controlConfigHash: args.controlConfigHash } : {}),
    envSummary: args.envSummary,
    substrateInstallerEngaged: args.substrateInstallerEngaged,
  };
}
