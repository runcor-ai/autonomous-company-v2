// Probe #4 — runcor-drives
//
// runcor-drives is PURE FUNCTIONS (zero deps, no LLM, no DB). Easy to test.
//
// Questions:
//   1. Do the 4 drive functions produce sensible signals for typical inputs?
//   2. Do they DIFFERENTIATE between similar scenarios (early vs late game)?
//   3. Empty inputs → 0 intensity? (V2 forensic showed reactivity at 0.85 — was that real?)
//   4. computeDrives() correctly aggregates + picks dominant drive
//   5. V2 wiring audit: does cycle.ts pass realistic inputs to all 4 drives?

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import {
  resourcePressure,
  curiosityPressure,
  reactivityPressure,
  coherencePressure,
  computeDrives,
  renderPressureBlock,
} from 'runcor-drives';

function close(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= tol;
}

async function main() {
  console.log('[probe-04] runcor-drives — pure functions, no external deps\n');
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // ── Phase 1: resource pressure ──
  console.log('=== Phase 1: resource ===');
  const r_full = resourcePressure({ remaining: 5, total: 5, burnPerCycle: 0.01, cyclesUsed: 0 });
  const r_mid = resourcePressure({ remaining: 2.5, total: 5, burnPerCycle: 0.01, cyclesUsed: 250 });
  const r_low = resourcePressure({ remaining: 0.5, total: 5, burnPerCycle: 0.01, cyclesUsed: 450 });
  const r_oom = resourcePressure({ remaining: 0.05, total: 5, burnPerCycle: 0.01, cyclesUsed: 495 });
  console.log(`  full budget:     intensity=${r_full.intensity.toFixed(3)} label=${r_full.label}`);
  console.log(`  mid (50% left):  intensity=${r_mid.intensity.toFixed(3)} label=${r_mid.label}`);
  console.log(`  low (10% left):  intensity=${r_low.intensity.toFixed(3)} label=${r_low.label}`);
  console.log(`  near OOM (1%):   intensity=${r_oom.intensity.toFixed(3)} label=${r_oom.label}`);
  checks.push({ name: 'resource: full < low < oom', pass: r_full.intensity < r_low.intensity && r_low.intensity < r_oom.intensity });
  checks.push({ name: 'resource: full budget intensity < 0.3', pass: r_full.intensity < 0.3 });
  checks.push({ name: 'resource: near-OOM intensity > 0.7', pass: r_oom.intensity > 0.7 });

  // ── Phase 2: curiosity ──
  console.log('\n=== Phase 2: curiosity ===');
  const c_all = curiosityPressure({ exploredAreas: ['a','b','c','d'], knownAreas: ['a','b','c','d'], recentExplorationCycles: 0 });
  const c_some = curiosityPressure({ exploredAreas: ['a','b'], knownAreas: ['a','b','c','d','e'], recentExplorationCycles: 5 });
  const c_none = curiosityPressure({ exploredAreas: [], knownAreas: ['a','b','c','d','e','f','g','h'], recentExplorationCycles: 100 });
  console.log(`  all explored:        intensity=${c_all.intensity.toFixed(3)} label=${c_all.label}`);
  console.log(`  some unexplored:     intensity=${c_some.intensity.toFixed(3)} label=${c_some.label}`);
  console.log(`  none explored:       intensity=${c_none.intensity.toFixed(3)} label=${c_none.label}`);
  checks.push({ name: 'curiosity: all-explored intensity low', pass: c_all.intensity < 0.3 });
  checks.push({ name: 'curiosity: rising as unexplored grows', pass: c_some.intensity < c_none.intensity });
  checks.push({ name: 'curiosity: zero-explored at high intensity', pass: c_none.intensity > 0.6 });

  // ── Phase 3: reactivity ──
  console.log('\n=== Phase 3: reactivity ===');
  const x_empty = reactivityPressure({ pendingEvents: [] });
  const x_one_low = reactivityPressure({ pendingEvents: [{ kind: 'msg', urgency: 'low', age: 0 }] });
  const x_one_critical = reactivityPressure({ pendingEvents: [{ kind: 'fire', urgency: 'critical', age: 0 }] });
  const x_aged = reactivityPressure({ pendingEvents: [{ kind: 'msg', urgency: 'medium', age: 10 }] });
  const x_multi = reactivityPressure({ pendingEvents: [
    { kind: 'email', urgency: 'medium', age: 2 },
    { kind: 'alert', urgency: 'high', age: 0 },
    { kind: 'ping', urgency: 'low', age: 1 },
  ] });
  console.log(`  no events:           intensity=${x_empty.intensity.toFixed(3)} label=${x_empty.label}`);
  console.log(`  1 low event:         intensity=${x_one_low.intensity.toFixed(3)} label=${x_one_low.label}`);
  console.log(`  1 critical event:    intensity=${x_one_critical.intensity.toFixed(3)} label=${x_one_critical.label}`);
  console.log(`  1 medium aged:       intensity=${x_aged.intensity.toFixed(3)} label=${x_aged.label}`);
  console.log(`  3 mixed events:      intensity=${x_multi.intensity.toFixed(3)} label=${x_multi.label}`);
  checks.push({ name: 'reactivity: empty → intensity 0', pass: x_empty.intensity === 0 });
  checks.push({ name: 'reactivity: critical > low', pass: x_one_critical.intensity > x_one_low.intensity });
  checks.push({ name: 'reactivity: aging amplifies', pass: x_aged.intensity > 0.5 });
  checks.push({ name: 'reactivity: multi-event bumps', pass: x_multi.intensity > x_one_critical.intensity * 0.5 });

  // ── Phase 4: coherence ──
  console.log('\n=== Phase 4: coherence ===');
  const h_empty = coherencePressure({ selfTheoryClaims: [], recentActions: [] });
  const h_match = coherencePressure({
    selfTheoryClaims: ['I prioritize customer interviews', 'I journal every decision'],
    recentActions: [
      { action: 'email_send to customer about interview', confidence: 0.8 },
      { action: 'fs_write decision-log.md cycle 50', confidence: 0.9 },
    ],
  });
  const h_mismatch = coherencePressure({
    selfTheoryClaims: ['I prioritize customer interviews', 'I never use email'],
    recentActions: [
      { action: 'web_search AI agents benchmark', confidence: 0.5 },
      { action: 'email_send to founder Q3 OKRs', confidence: 0.7 },
    ],
  });
  console.log(`  no claims/actions:   intensity=${h_empty.intensity.toFixed(3)} label=${h_empty.label}`);
  console.log(`  claims match acts:   intensity=${h_match.intensity.toFixed(3)} label=${h_match.label}`);
  console.log(`  claims contradict:   intensity=${h_mismatch.intensity.toFixed(3)} label=${h_mismatch.label}`);
  checks.push({ name: 'coherence: empty → intensity 0', pass: h_empty.intensity === 0 });
  checks.push({ name: 'coherence: mismatch > match', pass: h_mismatch.intensity > h_match.intensity });

  // ── Phase 5: computeDrives + dominant ──
  console.log('\n=== Phase 5: aggregator + dominant pick ===');
  const all = computeDrives({
    resource: { remaining: 4, total: 5, burnPerCycle: 0.01, cyclesUsed: 100 },
    curiosity: { exploredAreas: ['a','b'], knownAreas: ['a','b','c','d','e','f','g'], recentExplorationCycles: 20 },
    reactivity: { pendingEvents: [{ kind: 'fire', urgency: 'critical', age: 0 }] },
    coherence: { selfTheoryClaims: ['I am the CEO'], recentActions: [{ action: 'fs_write decision-log.md', confidence: 0.9 }] },
  });
  console.log(`  resource:   ${all.resource?.intensity.toFixed(3)} ${all.resource?.label}`);
  console.log(`  curiosity:  ${all.curiosity?.intensity.toFixed(3)} ${all.curiosity?.label}`);
  console.log(`  reactivity: ${all.reactivity?.intensity.toFixed(3)} ${all.reactivity?.label}`);
  console.log(`  coherence:  ${all.coherence?.intensity.toFixed(3)} ${all.coherence?.label}`);
  console.log(`  dominant:   ${all.dominantDrive} @ ${all.maxIntensity.toFixed(3)}`);
  console.log(`  summary:    ${all.summary}`);
  checks.push({ name: 'computeDrives picks reactivity as dominant (critical event)', pass: all.dominantDrive === 'reactivity' });

  console.log('\n  renderPressureBlock:');
  for (const l of renderPressureBlock(all).split('\n')) console.log('    ' + l);

  // ── Phase 6: V2 wiring audit ──
  console.log('\n=== Phase 6: V2 wiring audit ===');
  const cyclePath = 'C:/runcor May 3 2026/autonomous-company-v2/src/agent/cycle.ts';
  let hardcodedEmpty = false;
  let buildsReactivity = false;
  let buildsCuriosity = false;
  let buildsCoherence = false;
  try {
    const src = readFileSync(cyclePath, 'utf8');
    hardcodedEmpty = /pendingEvents\s*:\s*\[\s*\]/.test(src);
    buildsReactivity = /reactivity\s*:/.test(src);
    buildsCuriosity = /curiosity\s*:/.test(src);
    buildsCoherence = /coherence\s*:/.test(src);
    console.log(`  V2 cycle.ts hardcodes pendingEvents: []: ${hardcodedEmpty ? 'YES ← V2 reactivity always 0 from this input' : 'NO'}`);
    console.log(`  V2 cycle.ts builds reactivity inputs: ${buildsReactivity ? 'yes' : 'no'}`);
    console.log(`  V2 cycle.ts builds curiosity inputs:  ${buildsCuriosity ? 'yes' : 'no'}`);
    console.log(`  V2 cycle.ts builds coherence inputs:  ${buildsCoherence ? 'yes' : 'no'}`);
  } catch {
    console.log('  could not read V2 cycle.ts');
  }

  // ── PASS/FAIL ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'runcor-drives behaves correctly for typical inputs' : 'see failures'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
