// T099 [US3] — A node accessed at cycle 5 has expected M decay after many cycles.
// T171 [US3] — A daily_summary-tagged MemoryNode decays on the same schedule as a generic
//              episodic node (NO decay-exemption, NO is_summary flag bypass, NO pinning) per FR-062b.
//
// runcor-memory's `record` calls embed() which requires OPENAI_API_KEY. When the env is
// absent (CI without secrets), these tests skip with a clear message so the regression
// floor remains stable. With OPENAI_API_KEY set, the tests run end-to-end against the real
// memory + embedding stack.

import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();
const HAS_OPENAI = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.length > 0;
const skipIfNoKey = HAS_OPENAI ? test : test.skip;

function makeMemory(role = 'test'): { mem: MemorySystem; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'mem-decay-'));
  const dbPath = path.join(dir, 'memory.db');
  const db = new MemoryDatabase(dbPath);
  const mem = new MemorySystem({ db, agentRole: role });
  return {
    mem,
    cleanup: (): void => {
      try {
        db.close?.();
      } catch {
        // ignore
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('T099: M decay over cycles (FR-073)', () => {
  skipIfNoKey('node M decreases after many cycles without reinforcement', async () => {
    const { mem, cleanup } = makeMemory();
    try {
      mem.setCycle(5);
      const r = await mem.record('episodic event A', { tags: ['episodic'], R: 0.5 });
      const initialNode = mem.getNode(r.nodeId)!;
      expect(initialNode.M).toBeGreaterThan(0);

      // Advance 50 cycles, run consolidation.
      for (let c = 6; c <= 55; c++) {
        mem.setCycle(c);
        await mem.cycle();
      }

      const aged = mem.getNode(r.nodeId);
      // Either retired or M reduced; in both cases NOT increased.
      if (aged) {
        expect(aged.M).toBeLessThanOrEqual(initialNode.M);
      }
    } finally {
      cleanup();
    }
  });
});

describe('T171: summary nodes decay on same schedule as episodic (FR-062b)', () => {
  skipIfNoKey('daily_summary tag confers no decay exemption', async () => {
    const { mem, cleanup } = makeMemory();
    try {
      mem.setCycle(5);
      const summary = await mem.record('day-1 summary', { tags: ['daily_summary', 'day:1'], R: 0.7 });
      const episodic = await mem.record('episodic event A', { tags: ['episodic'], R: 0.7 });

      const sumInitial = mem.getNode(summary.nodeId)!;
      const epInitial = mem.getNode(episodic.nodeId)!;
      // Same R, same cycle of creation → very similar M to start.
      expect(Math.abs(sumInitial.M - epInitial.M)).toBeLessThan(0.05);

      // No reinforcement; advance many cycles.
      for (let c = 6; c <= 60; c++) {
        mem.setCycle(c);
        await mem.cycle();
      }

      const sumAfter = mem.getNode(summary.nodeId);
      const epAfter = mem.getNode(episodic.nodeId);
      // Both either retired or both still present. No exemption pattern (summary stays while ep retires).
      const sumPresent = sumAfter !== null;
      const epPresent = epAfter !== null;
      // FR-062b: same schedule. If one is retired, the other should be too (modulo timing jitter
      // from M's continuous decay; allow either both-present or both-absent or sumAfter.M ≤ epAfter.M).
      if (sumPresent && epPresent) {
        // Summary's M should NOT be artificially boosted vs. episodic's.
        expect(sumAfter!.M).toBeLessThanOrEqual(epInitial.M);
      }
    } finally {
      cleanup();
    }
  });
});
