// Probe #3 — runcor-goals
//
// Questions:
//   1. Does accept() create a goal at intensity 1.0?
//   2. Does reinforce() bump intensity AND reset lastReinforcedCycle?
//   3. Does decayStep() auto-retire goals below threshold?
//   4. Does accept() dedup on text or create new goals each call?
//      (V2 forensic suspicion: side-effects accepts the same text repeatedly → duplicates)
//   5. Does V2's side-effects.ts EVER call decayStep()?
//      (If no, goals are immortal because nothing decays them.)
//
// Run: npx tsx scripts/probe/03-goals.ts
//
// PASS criteria:
//   - accept creates distinct goals (even on same text — see note 4)
//   - reinforce bumps intensity and resets clock
//   - decayStep retires unreinforced goals after enough simulated cycles
//   - V2's side-effects.ts is checked for decayStep wiring — flag if absent

import 'dotenv/config';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Goals } from 'runcor-goals';

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'probe-goals-'));
  const dbPath = join(tmp, 'goals.db');
  console.log(`[probe-03] db=${dbPath}\n`);

  const goals = new Goals({ dbPath });

  // ── Phase 1: accept creates goals at intensity 1.0 ──
  console.log('=== Phase 1: accept() basics ===');
  const id1 = goals.accept(
    { text: 'achieve $5K MRR by cycle 60', level: 'objective', satisfactionCondition: 'MRR ≥ 5000' },
    { currentCycle: 100 },
  );
  const id2 = goals.accept(
    { text: 'launch outbound email campaign in next 7 cycles', level: 'initiative', satisfactionCondition: '50+ emails sent' },
    { currentCycle: 100 },
  );
  const id3 = goals.accept(
    { text: 'operate an autonomous company that earns its existence', level: 'purpose' },
    { currentCycle: 100 },
  );
  const g1 = goals.get(id1);
  const g2 = goals.get(id2);
  const g3 = goals.get(id3);
  console.log(`  id1 objective: intensity=${g1?.intensity} cadence=${g1?.decayCadence} threshold=${g1?.retirementThreshold}`);
  console.log(`  id2 initiative: intensity=${g2?.intensity} cadence=${g2?.decayCadence} threshold=${g2?.retirementThreshold}`);
  console.log(`  id3 purpose: intensity=${g3?.intensity} cadence=${g3?.decayCadence} threshold=${g3?.retirementThreshold}`);
  const activeStart = goals.active().length;
  console.log(`  active goals: ${activeStart}\n`);

  // ── Phase 2: does accept dedup on identical text? ──
  console.log('=== Phase 2: dedup test (V2 forensic concern) ===');
  console.log('Accepting the SAME goal text 4 times:');
  const dupIds: number[] = [];
  for (let i = 0; i < 4; i++) {
    const id = goals.accept(
      { text: 'push data_processor.py to a newly created GitHub repository', level: 'initiative' },
      { currentCycle: 200 + i },
    );
    dupIds.push(id);
    console.log(`  attempt ${i + 1}: id=${id}`);
  }
  const uniqueIds = new Set(dupIds).size;
  console.log(`  unique ids: ${uniqueIds}/4 (${uniqueIds === 4 ? 'NO DEDUP — duplicates created' : 'DEDUP — merged'})`);
  console.log(`  active goals now: ${goals.active().length}\n`);

  // ── Phase 3: reinforce bumps + resets clock ──
  console.log('=== Phase 3: reinforce() ===');
  const beforeReinforce = goals.get(id1);
  console.log(`  before: intensity=${beforeReinforce?.intensity} lastReinforcedCycle=${beforeReinforce?.lastReinforcedCycle}`);
  const ok = goals.reinforce(id1, { currentCycle: 110, evidence: 'closed a $1K deal' });
  const afterReinforce = goals.get(id1);
  console.log(`  reinforce returned: ${ok}`);
  console.log(`  after: intensity=${afterReinforce?.intensity} lastReinforcedCycle=${afterReinforce?.lastReinforcedCycle}\n`);

  // ── Phase 4: decayStep auto-retires unreinforced goals ──
  console.log('=== Phase 4: decayStep() auto-retirement ===');
  // The initiative goals have cadence=5, threshold=0.20. After ~6+ cycles past cadence, intensity falls below threshold.
  // Let's simulate 50 cycles past initial acceptance with no reinforcement.
  console.log('  simulating 50 cycles past initial acceptance, calling decayStep each cycle...');
  let totalRetired = 0;
  for (let c = 100; c < 250; c++) {
    const r = goals.decayStep(c);
    totalRetired += r.retiredThisStep;
    if (r.retiredThisStep > 0) console.log(`    cycle ${c}: retired ${r.retiredThisStep} goal(s) (active before: ${r.activeBefore})`);
  }
  const activeEnd = goals.active().length;
  console.log(`  total retired across 150 cycles: ${totalRetired}`);
  console.log(`  active goals remaining: ${activeEnd}\n`);

  // ── Phase 5: stack rendering ──
  console.log('=== Phase 5: stack() + renderBlock() ===');
  goals.accept({ text: 'establish weekly customer-interview cadence', level: 'initiative' }, { currentCycle: 300 });
  goals.accept({ text: 'draft Q3 strategy memo by cycle 400', level: 'objective' }, { currentCycle: 300 });
  const stack = goals.stack(300);
  console.log(`  stack: ${stack.summary}`);
  console.log(`  P/O/I counts: ${stack.purposes.length}P/${stack.objectives.length}O/${stack.initiatives.length}I`);
  console.log(`  dominant: ${stack.dominant ? `${stack.dominant.level} "${stack.dominant.text.slice(0, 50)}"` : 'none'}`);
  console.log(`  renderBlock:\n${goals.renderBlock(300).split('\n').map(l => '    ' + l).join('\n')}\n`);

  goals.close();

  // ── Phase 6: V2 wiring audit — does side-effects.ts call decayStep? ──
  console.log('=== Phase 6: V2 wiring audit ===');
  const sideEffectsPath = 'C:/runcor May 3 2026/autonomous-company-v2/src/agent/side-effects.ts';
  let v2CallsDecayStep = false;
  try {
    const source = readFileSync(sideEffectsPath, 'utf8');
    v2CallsDecayStep = /decayStep\s*\(/.test(source);
    console.log(`  V2 side-effects.ts calls decayStep(): ${v2CallsDecayStep ? 'YES' : 'NO ← BUG (goals never retire in V2)'}`);
  } catch {
    console.log('  could not read V2 side-effects.ts');
  }

  // ── PASS/FAIL ──
  const passes = {
    'accept creates at intensity 1.0': g1?.intensity === 1.0 && g2?.intensity === 1.0 && g3?.intensity === 1.0,
    'reinforce bumps intensity': afterReinforce !== undefined && beforeReinforce !== undefined && afterReinforce.intensity > beforeReinforce.intensity,
    'reinforce resets clock': afterReinforce?.lastReinforcedCycle === 110,
    'decayStep auto-retires unreinforced goals': totalRetired >= 1,
    'no silent dedup (each accept creates new goal)': uniqueIds === 4,
    'V2 side-effects.ts calls decayStep()': v2CallsDecayStep,
  };
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const [k, v] of Object.entries(passes)) {
    console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
    if (!v) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'runcor-goals functions correctly + V2 wires it correctly' : 'see failing assertions'}`);

  rmSync(tmp, { recursive: true, force: true });
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
