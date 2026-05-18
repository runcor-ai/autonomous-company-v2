// Probe #7 — runcor-identity
//
// Questions:
//   1. Does current() return initial empty state on fresh init?
//   2. Does setTrait() update trait + create new version?
//   3. Does reflect() with a mock dialectic produce updated claims/traits?
//   4. Does reflect() converge: 3 reflections with same input → stable claims?
//   5. Does history() return prior versions?
//   6. Does renderBlock() produce prompt-ready output?
//   7. V2 wiring audit: side-effects calls reflect()? Readiness gate threshold?

import 'dotenv/config';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Identity } from 'runcor-identity';

// Mock dialectic that returns deterministic, sensible self-theory updates.
function makeMockDialectic(seedClaims: string[], seedTraits: Record<string, number>) {
  let callCount = 0;
  return async (cfg: { problem: string; maxRounds?: number }) => {
    callCount++;
    void cfg;
    return {
      answer: JSON.stringify({
        claims: seedClaims,
        traits: seedTraits,
        rationale: `Mock reflection #${callCount}: updated based on recent actions.`,
      }),
    };
  };
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'probe-identity-'));
  const dbPath = join(tmp, 'identity.db');
  console.log(`[probe-07] db=${dbPath}\n`);

  const id = new Identity({ dbPath });
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // ── Phase 1: initial state ──
  console.log('=== Phase 1: initial current() ===');
  const start = id.current();
  console.log(`  version=${start.version} claims=${start.claims.length} traits=${Object.keys(start.traits).length} lastReflectedCycle=${start.lastReflectedCycle}`);
  checks.push({ name: 'initial version is 1', pass: start.version === 1 });
  checks.push({ name: 'initial claims empty', pass: start.claims.length === 0 });

  // ── Phase 2: setTrait ──
  console.log('\n=== Phase 2: setTrait() ===');
  const t1 = id.setTrait('risk_tolerance', 0.65);
  const t2 = id.setTrait('exploration_appetite', 0.40);
  console.log(`  after 2 setTraits: version=${t2.version} traits=${JSON.stringify(t2.traits)}`);
  checks.push({ name: 'setTrait creates new version', pass: t2.version > start.version });
  checks.push({ name: 'setTrait stores value', pass: id.getTrait('risk_tolerance') === 0.65 });

  // ── Phase 3: reflect() with mock dialectic ──
  console.log('\n=== Phase 3: reflect() updates claims/traits ===');
  const seedClaims = [
    'I am the CEO of an early-stage company',
    'I prioritize long-term durability over short-term wins',
    'I journal every material decision',
  ];
  const seedTraits = { risk_tolerance: 0.6, exploration_appetite: 0.4, drive_decisiveness: 0.75 };
  const reflectInput = {
    recentActions: [
      { action: 'inbox_read', confidence: 0.8, score: 0.7 },
      { action: 'fs_write decision-log.md', confidence: 0.9, score: 0.85 },
      { action: 'email_send to founder', confidence: 0.7, score: 0.75 },
    ],
    context: 'Cycle 50 reflective audit',
    dialectic: makeMockDialectic(seedClaims, seedTraits),
    currentCycle: 50,
    cause: 'periodic',
  };
  const reflected = await id.reflect(reflectInput);
  console.log(`  after reflect: version=${reflected.version} claims=${reflected.claims.length} traits=${JSON.stringify(reflected.traits)}`);
  console.log(`  claims:`);
  for (const c of reflected.claims) console.log(`    - "${c}"`);
  checks.push({ name: 'reflect populates claims', pass: reflected.claims.length === seedClaims.length });
  checks.push({ name: 'reflect sets lastReflectedCycle', pass: reflected.lastReflectedCycle === 50 });
  checks.push({ name: 'reflect updates traits', pass: reflected.traits.drive_decisiveness === 0.75 });

  // ── Phase 4: convergence (3 reflections same input) ──
  console.log('\n=== Phase 4: convergence — 3 reflections with same dialectic output ===');
  const claimSets: string[][] = [];
  for (let i = 0; i < 3; i++) {
    const r = await id.reflect({
      ...reflectInput,
      currentCycle: 50 + (i + 1) * 20,
      dialectic: makeMockDialectic(seedClaims, seedTraits),
    });
    claimSets.push(r.claims);
    console.log(`  reflection ${i + 1}: v${r.version}, ${r.claims.length} claims, cycle=${r.lastReflectedCycle}`);
  }
  const allStable = claimSets.every(s => s.length === seedClaims.length && s.every((c, i) => c === seedClaims[i]));
  checks.push({ name: 'claims stable across repeated reflections', pass: allStable });

  // ── Phase 5: history ──
  console.log('\n=== Phase 5: history() ===');
  const hist = id.history(10);
  console.log(`  history count: ${hist.length}`);
  console.log(`  versions: ${hist.map(h => `v${h.version}`).join(', ')}`);
  checks.push({ name: 'history returns prior snapshots', pass: hist.length >= 4 });

  // ── Phase 6: renderBlock ──
  console.log('\n=== Phase 6: renderBlock() ===');
  const block = id.renderBlock();
  console.log('  rendered block:');
  for (const l of block.split('\n')) console.log('    ' + l);
  checks.push({ name: 'renderBlock includes claims', pass: block.includes('I am the CEO') });
  checks.push({ name: 'renderBlock includes traits', pass: block.includes('risk_tolerance') });

  id.close();

  // ── Phase 7: V2 wiring audit ──
  console.log('\n=== Phase 7: V2 wiring audit ===');
  const sideEffectsSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/side-effects.ts', 'utf8');
  const identityReflectCalled = /identity\.reflect\s*\(/.test(sideEffectsSrc);
  const cadenceMatch = sideEffectsSrc.match(/IDENTITY_REFLECT_EVERY\s*=\s*(\d+)/);
  const cadence = cadenceMatch ? parseInt(cadenceMatch[1]!, 10) : 0;
  const gateMatch = sideEffectsSrc.match(/MIN_DATA_ENTITIES_FOR_IDENTITY_REFLECT\s*=\s*(\d+)/);
  const gate = gateMatch ? parseInt(gateMatch[1]!, 10) : 0;
  console.log(`  V2 side-effects calls identity.reflect(): ${identityReflectCalled ? 'YES' : 'NO'}`);
  console.log(`  Reflection cadence: every ${cadence} cycles`);
  console.log(`  Readiness gate: ≥${gate} data-cube entities required`);
  console.log(`  → V2 forensic: cube stayed at <15 entities → gate never released → identity stayed v1 forever`);
  checks.push({ name: 'V2 calls identity.reflect()', pass: identityReflectCalled });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'identity works + V2 wires it correctly (but gate blocks in practice)' : 'see failures'}`);

  rmSync(tmp, { recursive: true, force: true });
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
