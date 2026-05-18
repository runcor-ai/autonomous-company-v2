// Probe #12 — runcor-integration
//
// PROMOTED (per design decision 2026-05-18): this is critical for both
// (a) lattice-coordination via MCP, and
// (b) knowledge-source connection at the lattice/harness boot.
//
// Questions:
//   1. Does createIntegration() construct cleanly?
//   2. Are discoverSchemas + synthesizeTools + registerWithEngine on the surface?
//   3. Does V2 actually pass reachableSources to boot? (Audit: probably not — empty by default.)

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createIntegration, DEFAULT_SAFETY_POLICY } from 'runcor-integration';

async function main() {
  console.log('[probe-12] runcor-integration — schema discovery + dynamic MCP tools\n');
  const checks: Array<{ name: string; pass: boolean }> = [];

  // ── Phase 1: integration constructs ──
  console.log('=== Phase 1: createIntegration() ===');
  try {
    const integration = createIntegration({ dbPath: ':memory:' });
    const proto = Object.getPrototypeOf(integration);
    const methods = Object.getOwnPropertyNames(proto).filter(m => m !== 'constructor');
    console.log(`  constructed: ${typeof integration}`);
    console.log(`  methods: ${methods.join(', ')}`);
    console.log(`  DEFAULT_SAFETY_POLICY keys: ${Object.keys(DEFAULT_SAFETY_POLICY).join(', ')}`);
    checks.push({ name: 'createIntegration constructs', pass: typeof integration === 'object' });
    checks.push({ name: 'has discoverSchemas method', pass: methods.includes('discoverSchemas') });
    checks.push({ name: 'has synthesizeTools method', pass: methods.includes('synthesizeTools') });
    checks.push({ name: 'has registerWithEngine method', pass: methods.includes('registerWithEngine') });
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    checks.push({ name: 'createIntegration constructs', pass: false });
  }

  // ── Phase 2: V2 wiring audit ──
  console.log('\n=== Phase 2: V2 wiring audit ===');
  const bootSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/boot/boot.ts', 'utf8');
  const agentSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/index.ts', 'utf8');
  const constructsIntegration = /createIntegration\s*\(/.test(bootSrc);
  const callsDiscover = /integration\.discoverSchemas\s*\(/.test(bootSrc);
  const callsSynthesize = /integration\.synthesizeTools\s*\(/.test(bootSrc);
  const callsRegister = /integration\.registerWithEngine\s*\(/.test(bootSrc);
  const reachableSourcesPassedFromAgent = /reachableSources\s*:/.test(agentSrc);
  const reachableSourcesGuarded = /reachableSources && args\.reachableSources\.length > 0/.test(bootSrc);
  console.log(`  V2 boot creates Integration: ${constructsIntegration ? 'YES' : 'NO'}`);
  console.log(`  V2 boot calls discoverSchemas: ${callsDiscover ? 'YES (conditional)' : 'NO'}`);
  console.log(`  V2 boot calls synthesizeTools: ${callsSynthesize ? 'YES (conditional)' : 'NO'}`);
  console.log(`  V2 boot calls registerWithEngine: ${callsRegister ? 'YES (conditional)' : 'NO'}`);
  console.log(`  V2 boot guards on reachableSources non-empty: ${reachableSourcesGuarded ? 'YES' : 'NO'}`);
  console.log(`  V2 agent/index.ts passes reachableSources to boot(): ${reachableSourcesPassedFromAgent ? 'YES' : 'NO ← integration is dormant'}`);
  checks.push({ name: 'V2 constructs Integration', pass: constructsIntegration });
  checks.push({ name: 'V2 calls discoverSchemas + synthesizeTools + registerWithEngine', pass: callsDiscover && callsSynthesize && callsRegister });
  checks.push({ name: 'V2 actually passes reachableSources from agent', pass: reachableSourcesPassedFromAgent });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'integration works + V2 wires it functionally' : 'integration is constructed but dormant (no reachableSources passed)'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
