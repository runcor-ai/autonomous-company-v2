// T146 [US9] — result.md generator structure.

import { describe, expect, test, beforeEach } from 'vitest';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import { generateResultMd } from '../../src/agent/result-md.js';
import { EventBus } from '../../src/dashboard/event-bus.js';
import type { StartupRecord } from '../../src/boot/startup-record.js';

let memory: MemorySystem;

beforeEach(() => {
  memory = new MemorySystem({ db: new MemoryDatabase(':memory:') });
});

const FAKE_STARTUP: StartupRecord = {
  bootedAt: 1_700_000_000_000,
  agentRole: 'v2',
  components: [
    { name: 'runcor', pinnedVersion: '0.3.1', healthCheck: 'pass' },
  ],
  envSummary: {
    hasOpenRouterKey: true,
    hasOperatorAuthToken: true,
    hasFirecrawlKey: false,
    hasRunnerEmail: false,
    hasGitPushCreds: false,
  },
  substrateInstallerEngaged: true,
};

describe('generateResultMd', () => {
  test('contains required sections (FR-110, FR-120)', () => {
    const md = generateResultMd({
      agentRole: 'v2',
      startupRecord: FAKE_STARTUP,
      memory,
      bus: new EventBus(),
      cyclesRun: 50,
      totalSpentUsd: 12.34,
      reason: 'maxCycles',
      terminationReason: null,
    });
    expect(md).toContain('# V2 Primordial Agent');
    expect(md).toContain('Cycles run:** 50');
    expect(md).toContain('Total spend:** $12.34');
    expect(md).toContain('## Identity progression');
    expect(md).toContain('## Final goal stack');
    expect(md).toContain('## Daily summaries');
    expect(md).toContain('## Discernment flags');
    expect(md).toContain('## Component health');
  });

  test('handles empty memory gracefully (FR-110a — published on null)', () => {
    const md = generateResultMd({
      agentRole: 'v2',
      startupRecord: FAKE_STARTUP,
      memory,
      bus: new EventBus(),
      cyclesRun: 0,
      totalSpentUsd: 0,
      reason: 'terminated',
      terminationReason: 'operator pause',
    });
    expect(md).toContain('No identity reflections');
    expect(md).toContain('No active goals');
    expect(md).toContain('No daily summaries');
    expect(md).toContain('No discernment flags');
  });

  test('reports control runs as Naive Control (Principle VI)', () => {
    const md = generateResultMd({
      agentRole: 'control',
      startupRecord: { ...FAKE_STARTUP, agentRole: 'control' },
      memory,
      bus: new EventBus(),
      cyclesRun: 10,
      totalSpentUsd: 1.0,
      reason: 'maxCycles',
      terminationReason: null,
    });
    expect(md).toContain('# V2 Naive Control');
  });
});
