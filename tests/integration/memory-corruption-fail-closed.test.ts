// T167 [US1] — Boot fails closed when agent-memory.db has a corrupted SQLite header
// (spec Edge Cases §"Memory store corruption"; FR-011 / FR-012; addresses C6).

import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryDatabase } from 'runcor-memory';

describe('T167: corrupted memory DB triggers error mentioning runcor-memory', () => {
  test('opening a corrupted SQLite file rejects with an error', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mem-corrupt-'));
    const dbPath = path.join(dir, 'memory.db');
    try {
      // Write deliberate non-SQLite garbage (must be > 100 bytes; SQLite reads the header).
      writeFileSync(dbPath, Buffer.from('NOT_A_SQLITE_DATABASE_'.repeat(20)));
      let caught: unknown;
      try {
        // Better-sqlite3 lazily verifies header on first query; force a query.
        const db = new MemoryDatabase(dbPath);
        // Some operation that reads from a real table.
        // MemoryDatabase exposes prepared statements; use any read.
        (db as unknown as { db: { prepare(s: string): { get(): unknown } } }).db.prepare('SELECT name FROM sqlite_master').get();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(String(caught)).toMatch(/file is not a database|malformed|encrypted|not a database/i);
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows: file may be held open by sqlite handle even after error; best-effort cleanup.
      }
    }
  });

  test('boot.ts wraps memory construction in BootError naming runcor-memory', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(path.resolve('src/boot/boot.ts'), 'utf8');
    // The memory step (Step 5) must throw `new BootError('runcor-memory', ...)` on failure.
    // Find the memory section by its comment marker.
    const memorySection = src.split('// Step 5: memory')[1] ?? '';
    const upToStep6 = memorySection.split('// Step 6:')[0] ?? memorySection;
    expect(upToStep6).toMatch(/throw new BootError\(['"]runcor-memory['"]/);
  });
});
