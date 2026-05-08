// RESET_ON_BOOT — wipes agent state per role while preserving operator.db.
// Locks the file-list contract so no future commit silently drifts what gets wiped
// (especially: don't ever wipe operator.db; don't ever skip the cycle-state file).

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BOOT_PATH = path.resolve('src/boot/boot.ts');

let src: string;
async function load(): Promise<string> {
  if (!src) src = await readFile(BOOT_PATH, 'utf8');
  return src;
}

describe('RESET_ON_BOOT', () => {
  test('boot.ts gates the reset on env.resetOnBoot', async () => {
    const s = await load();
    expect(s).toMatch(/if \(env\.resetOnBoot\)/);
    expect(s).toMatch(/performResetOnBoot\(/);
  });

  test('reset runs BEFORE component init (step 1.5, before step 2)', async () => {
    const s = await load();
    // Use the call-site signature (with `env.` arg) to skip the function declaration.
    const resetCallIdx = s.indexOf('performResetOnBoot(env.agentStateDir');
    // The verifyComponentResolution() call inside boot() — first paren-call form.
    // Skip the function declaration `function verifyComponentResolution(`.
    const componentResIdx = s.indexOf('= verifyComponentResolution();');
    const memInitIdx = s.indexOf('new MemorySystem(');
    expect(resetCallIdx).toBeGreaterThan(0);
    expect(componentResIdx).toBeGreaterThan(0);
    expect(memInitIdx).toBeGreaterThan(0);
    expect(resetCallIdx).toBeLessThan(componentResIdx);
    expect(resetCallIdx).toBeLessThan(memInitIdx);
  });

  test('reset wipes all 7 sibling-DB bases per role + cycle-state JSON', async () => {
    const s = await load();
    // Required sibling-DB bases — drift here means a sibling's state survives the reset
    // and pollutes the fresh run.
    const required = ['memory', 'data', 'temporal', 'identity', 'goals', 'coherence', 'integration'];
    for (const base of required) {
      // Either present in componentDbBases array literal, or referenced explicitly.
      expect(s).toMatch(new RegExp(`['"\`]${base}['"\`]`));
    }
    expect(s).toMatch(/cycle-state-\$\{agentRole\}\.json/);
  });

  test('reset uses dbPathFor prefix mapping (v2 → agent, control → control)', async () => {
    // Locked because the first attempted reset on Railway used `${agentRole}` directly,
    // producing v2-memory.db / v2-identity.db etc. — files that don't exist. The real files
    // are agent-memory.db, agent-identity.db (per dbPathFor at boot.ts:93-97). The wrong
    // prefix means identity + goals + memory survived the reset, taking the corrupted
    // self-theory with them. This test enforces the prefix derivation.
    const s = await load();
    // Match the canonical mapping: agentRole === 'v2' ? 'agent' : 'control'
    expect(s).toMatch(/agentRole\s*===\s*['"]v2['"]\s*\?\s*['"]agent['"]\s*:\s*['"]control['"]/);
    // Targets array assembly must use the prefix variable, not agentRole directly, for the
    // sibling-DB filenames.
    expect(s).toMatch(/\$\{dbPrefix\}-\$\{base\}\$\{suf\}/);
    // Negative: the per-role-component target line must NOT use agentRole directly for DBs.
    // (cycle-state-${agentRole}.json IS allowed because that file genuinely uses agentRole.)
    const fnStart = s.indexOf('async function performResetOnBoot(');
    const fnEnd = s.indexOf('\nexport async function boot(', fnStart);
    const fnBody = s.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/\$\{agentRole\}-\$\{base\}/);
  });

  test('reset wipes role-shared dashboard files (bus-events, summaries, rater)', async () => {
    const s = await load();
    expect(s).toMatch(/bus-events\.jsonl/);
    expect(s).toMatch(/dashboard-summaries\.json/);
    expect(s).toMatch(/['"\`]rater\$\{suf\}['"\`]/);
  });

  test('reset includes -wal + -shm SQLite sidecars (else stale WAL data resurfaces)', async () => {
    const s = await load();
    expect(s).toMatch(/'\.db-wal'/);
    expect(s).toMatch(/'\.db-shm'/);
  });

  test('reset PRESERVES operator.db — never pushed into the targets array', async () => {
    const s = await load();
    const fnStart = s.indexOf('async function performResetOnBoot(');
    const fnEnd = s.indexOf('\nexport async function boot(', fnStart);
    expect(fnStart).toBeGreaterThan(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = s.slice(fnStart, fnEnd);
    // The mechanism guarantee: no targets.push line references operator.db.
    const pushLines = fnBody.match(/targets\.push\([^)]+\)/g) ?? [];
    for (const line of pushLines) {
      expect(line).not.toMatch(/operator/i);
    }
    // The doc guarantee: a PRESERVED comment names operator.db so future readers know why.
    expect(fnBody).toMatch(/PRESERVED[\s\S]*?operator\.db/i);
  });

  test('reset clears scratchpad contents but uses scratchpadDir from arg', async () => {
    const s = await load();
    // scratchpad clear is gated to scratchpadDir param + uses readdir + rm.
    expect(s).toMatch(/readdir\(scratchpadDir\)/);
    expect(s).toMatch(/scratchpad\/\$\{entry\}/);
  });

  test('reset is best-effort — failures logged but do not throw', async () => {
    const s = await load();
    const fnStart = s.indexOf('async function performResetOnBoot(');
    const fnEnd = s.indexOf('\nexport async function boot(', fnStart);
    const fnBody = s.slice(fnStart, fnEnd);
    // Must catch errors per-target (otherwise a single missing file aborts the reset).
    expect(fnBody).toMatch(/catch \(err\)/);
    // Must NOT re-throw inside performResetOnBoot.
    expect(fnBody).not.toMatch(/throw new BootError/);
    expect(fnBody).not.toMatch(/throw err/);
  });
});
