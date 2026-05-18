// Probe #9 — runcor-temporal
//
// Pure functions, no LLM, no DB (mostly). Fast probe.
//
// Questions:
//   1. Does computeNextWake produce sensible sleep ms for various pressure inputs?
//   2. Does isDayBoundary trigger on cycle-count OR real-hours criteria?
//   3. Does the cycle agent use computeNextWake or hardcoded fixed cadence?

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import {
  computeNextWake,
  isDayBoundary,
  BASE_WAKE_INTERVAL_MS,
  MIN_GAP_MS,
  MAX_GAP_MS,
} from 'runcor-temporal';

async function main() {
  console.log('[probe-09] runcor-temporal — pure helper functions\n');
  const checks: Array<{ name: string; pass: boolean }> = [];

  // ── Phase 1: computeNextWake — idle case ──
  console.log('=== Phase 1: computeNextWake ===');
  const idle = computeNextWake({
    drives: { resource: 0, curiosity: 0, reactivity: 0, coherence: 0 },
    pendingDeadlines: 0,
    overdueCommitments: 0,
    unresolvedCoherenceProblems: 0,
    currentCycle: 1,
  });
  console.log(`  idle (zero pressure): ms=${idle.ms} (${(idle.ms / 1000 / 60).toFixed(1)} min) reason="${idle.reason}"`);
  checks.push({ name: 'idle = BASE interval (30 min)', pass: idle.ms === BASE_WAKE_INTERVAL_MS });

  const moderate = computeNextWake({
    drives: { resource: 0.3, curiosity: 0.5, reactivity: 0.2, coherence: 0 },
    pendingDeadlines: 1,
    overdueCommitments: 0,
    unresolvedCoherenceProblems: 0,
    currentCycle: 50,
  });
  console.log(`  moderate pressure:    ms=${moderate.ms} (${(moderate.ms / 1000 / 60).toFixed(1)} min) reason="${moderate.reason}"`);
  checks.push({ name: 'moderate pressure shortens wake', pass: moderate.ms < idle.ms });

  const high = computeNextWake({
    drives: { resource: 0.9, curiosity: 0.8, reactivity: 1.0, coherence: 0.7 },
    pendingDeadlines: 5,
    overdueCommitments: 3,
    unresolvedCoherenceProblems: 2,
    currentCycle: 200,
  });
  console.log(`  high pressure:        ms=${high.ms} (${(high.ms / 1000).toFixed(0)}s) reason="${high.reason}"`);
  checks.push({ name: 'high pressure shortens further', pass: high.ms < moderate.ms });
  checks.push({ name: 'wake clamped to MIN floor (30s)', pass: high.ms >= MIN_GAP_MS });

  // ── Phase 2: isDayBoundary ──
  console.log('\n=== Phase 2: isDayBoundary ===');
  const earlyDay = isDayBoundary({ currentCycle: 100, lastBoundaryCycle: null, realHoursSinceLastBoundary: 5 });
  const cyclesCrossed = isDayBoundary({ currentCycle: 250, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 5 });
  const hoursCrossed = isDayBoundary({ currentCycle: 50, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 25 });
  const both = isDayBoundary({ currentCycle: 250, lastBoundaryCycle: 0, realHoursSinceLastBoundary: 25 });
  console.log(`  early (50 cycles, 5h):  ${earlyDay}`);
  console.log(`  cycles crossed (250, 5h): ${cyclesCrossed}`);
  console.log(`  hours crossed (50, 25h):  ${hoursCrossed}`);
  console.log(`  both crossed:             ${both}`);
  checks.push({ name: 'early day → no boundary', pass: !earlyDay });
  checks.push({ name: 'cycle threshold (200) triggers', pass: cyclesCrossed });
  checks.push({ name: 'real-hours threshold (24h) triggers', pass: hoursCrossed });

  // ── Phase 3: V2 wiring audit ──
  console.log('\n=== Phase 3: V2 wiring audit ===');
  const cycleSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/cycle.ts', 'utf8');
  const usesComputeNextWake = /computeNextWake\s*\(/.test(cycleSrc);
  const usesIsDayBoundary = /isDayBoundary\s*\(/.test(cycleSrc);
  const fixedCadenceFallback = /fixedSleepMs/.test(cycleSrc);
  console.log(`  cycle.ts calls computeNextWake(): ${usesComputeNextWake ? 'YES' : 'NO'}`);
  console.log(`  cycle.ts calls isDayBoundary(): ${usesIsDayBoundary ? 'YES' : 'NO'}`);
  console.log(`  cycle.ts has fixedSleepMs fallback: ${fixedCadenceFallback ? 'YES (likely used by control)' : 'NO'}`);
  checks.push({ name: 'V2 cycle calls computeNextWake', pass: usesComputeNextWake });
  checks.push({ name: 'V2 cycle calls isDayBoundary', pass: usesIsDayBoundary });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'temporal functions + V2 wires correctly' : 'see failures'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
