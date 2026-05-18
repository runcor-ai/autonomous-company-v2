// Tier 4 integration probe — verify Meta + Coherence wiring without a V2 cycle loop.
//
// Cost: ZERO LLM calls. Pure construction + DB writes + layer-render assertions.
//
// Sections:
//   1. Meta construction creates the DB file at the expected path
//   2. recordTrajectory() persists calibration entries
//   3. meta.pressure() returns a non-null PressureSignal once basedOn >= 1
//   4. MetaPressureLayer.render() produces non-empty text from a populated Meta
//   5. Coherence construction creates the DB file
//   6. coherence.detect({}) runs without throwing (no problems expected from cold start)
//   7. CoherenceProblemLayer.render() returns '' on empty problems (correct silent state)
//
// Exit 0 = all pass.

import 'dotenv/config';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMeta } from 'runcor-meta';
import { createCoherence } from 'runcor-coherence';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import type { LayerContext } from 'runcor-substrate';
import { MetaPressureLayer } from '../../src/substrate-layers/meta-pressure.js';
import { CoherenceProblemLayer } from '../../src/substrate-layers/coherence-problems.js';

const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];
function pass(name: string): void { checks.push({ name, pass: true }); }
function fail(name: string, detail?: string): void { checks.push({ name, pass: false, detail }); }

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('FAIL — OPENAI_API_KEY required (for memory embeddings used by coherence)'); process.exit(2); }
  const tmp = mkdtempSync(join(tmpdir(), 'tier4-probe-'));
  console.log(`[tier4-probe] tmp=${tmp}\n`);

  // Shared memory the coherence component needs.
  const memDb = new MemoryDatabase(join(tmp, 'mem.db'));
  const memory = new MemorySystem(memDb, { openaiKey: apiKey });

  // ─────────────────────────────────────────────────────────────────
  // SECTION 1: Meta construction creates DB
  console.log('─── 1. Meta construction ─────────────────────────────');
  const metaDbPath = join(tmp, 'meta.db');
  const meta = createMeta({
    dbPath: metaDbPath,
    dialectic: async ({ problem }) => ({ answer: `mock-judge: ${problem.slice(0, 40)}` }),
  });
  if (existsSync(metaDbPath) && statSync(metaDbPath).size > 0) {
    pass(`meta DB file created at ${metaDbPath} (${statSync(metaDbPath).size} bytes)`);
  } else {
    fail(`meta DB file MISSING at ${metaDbPath}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION 2: recordTrajectory persists
  console.log('\n─── 2. recordTrajectory persistence ──────────────────');
  await meta.recordTrajectory({ problem: 'cycle 1', inputSummary: 'inbox_read', outputSummary: 'completed' }, 0.4, 'no action taken', true);
  await meta.recordTrajectory({ problem: 'cycle 2', inputSummary: 'github_create_repo', outputSummary: 'completed' }, 0.8, 'invoked github_create_repo', true);
  await meta.recordTrajectory({ problem: 'cycle 3', inputSummary: '(none)', outputSummary: 'cycle_failed_call' }, 0.1, 'cycle failed', false);
  // Read DB to confirm rows present.
  const Database = (await import('better-sqlite3')).default;
  const dbR = new Database(metaDbPath, { readonly: true });
  const tables = dbR.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
  console.log(`  meta DB tables: ${tables.map((t) => t.name).join(', ')}`);
  let totalRows = 0;
  for (const t of tables) {
    if (t.name === 'sqlite_sequence') continue;
    const count = (dbR.prepare(`SELECT COUNT(*) as c FROM ${t.name}`).get() as { c: number }).c;
    console.log(`    ${t.name}: ${count} rows`);
    totalRows += count;
  }
  dbR.close();
  if (totalRows >= 3) pass(`recordTrajectory persisted ${totalRows} rows across calibration tables`);
  else fail(`expected >=3 rows, got ${totalRows}`);

  // ─────────────────────────────────────────────────────────────────
  // SECTION 3: meta.pressure() returns signal
  console.log('\n─── 3. meta.pressure() returns signal ───────────────');
  let signal;
  try {
    signal = meta.pressure();
    console.log(`  signal: ${JSON.stringify(signal)}`);
    if (signal && signal.basedOn >= 1) {
      pass(`pressure() returned signal with basedOn=${signal.basedOn}, recentQuality=${signal.recentQuality}`);
    } else {
      fail(`pressure() returned ${JSON.stringify(signal)} — expected basedOn>=1`);
    }
  } catch (e) {
    fail(`pressure() threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION 4: MetaPressureLayer renders non-empty text
  console.log('\n─── 4. MetaPressureLayer.render() ───────────────────');
  const metaLayer = new MetaPressureLayer(() => meta);
  const ctx: LayerContext = { cycle: 10 } as LayerContext;
  const metaRender = metaLayer.render(ctx);
  console.log(`  rendered:\n${metaRender.split('\n').map((l) => '    ' + l).join('\n')}`);
  if (metaRender.length > 0 && metaRender.includes('Self-monitoring pressure')) {
    pass(`MetaPressureLayer rendered ${metaRender.length}-char text including 'Self-monitoring pressure'`);
  } else {
    fail(`MetaPressureLayer rendered empty or missing expected token: ${JSON.stringify(metaRender)}`);
  }

  // Layer with null getter should render empty (control mode).
  const nullLayer = new MetaPressureLayer(() => null);
  if (nullLayer.render(ctx) === '') pass(`MetaPressureLayer with null getter renders '' (control-mode-safe)`);
  else fail(`MetaPressureLayer with null getter rendered non-empty: ${JSON.stringify(nullLayer.render(ctx))}`);

  // ─────────────────────────────────────────────────────────────────
  // SECTION 5: Coherence construction creates DB
  console.log('\n─── 5. Coherence construction ──────────────────────');
  const cohDbPath = join(tmp, 'coh.db');
  const coherence = createCoherence({ dbPath: cohDbPath, memory });
  if (existsSync(cohDbPath) && statSync(cohDbPath).size > 0) {
    pass(`coherence DB file created at ${cohDbPath} (${statSync(cohDbPath).size} bytes)`);
  } else {
    fail(`coherence DB file MISSING at ${cohDbPath}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION 6: coherence.detect({}) doesn't throw
  console.log('\n─── 6. coherence.detect({}) ─────────────────────────');
  try {
    const detected = await coherence.detect({});
    console.log(`  detect() returned: ${JSON.stringify(detected).slice(0, 200)}`);
    pass(`coherence.detect({}) ran without throwing`);
  } catch (e) {
    fail(`coherence.detect({}) threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // SECTION 7: CoherenceProblemLayer renders correctly
  console.log('\n─── 7. CoherenceProblemLayer.render() ──────────────');
  const cohLayer = new CoherenceProblemLayer(() => coherence);
  const cohRender = cohLayer.render(ctx);
  console.log(`  rendered (length=${cohRender.length}): ${JSON.stringify(cohRender).slice(0, 200)}`);
  // Empty render on cold start is CORRECT — coherence found nothing to surface.
  if (cohRender === '') {
    pass(`CoherenceProblemLayer renders '' when no problems exist (correct silent state)`);
  } else if (cohRender.includes('Coherence problems')) {
    pass(`CoherenceProblemLayer rendered ${cohRender.length}-char text with header`);
  } else {
    fail(`CoherenceProblemLayer rendered unexpected text: ${JSON.stringify(cohRender)}`);
  }

  // Layer with null getter should render empty.
  const nullCohLayer = new CoherenceProblemLayer(() => null);
  if (nullCohLayer.render(ctx) === '') pass(`CoherenceProblemLayer with null getter renders '' (control-mode-safe)`);
  else fail(`CoherenceProblemLayer with null getter rendered non-empty`);

  // ─────────────────────────────────────────────────────────────────
  // Summary
  console.log('\n═══ Tier 4 probe summary ═══════════════════════════');
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'} — ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  }
  console.log(`\n  ${passed}/${checks.length} checks passed${failed > 0 ? ` — ${failed} failed` : ''}`);

  // Cleanup tmpdir
  memDb.close();
  rmSync(tmp, { recursive: true, force: true });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[tier4-probe] FATAL:', err);
  process.exit(2);
});
