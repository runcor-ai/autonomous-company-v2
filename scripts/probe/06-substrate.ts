// Probe #6 — runcor-substrate
//
// Questions:
//   1. Does PromptStack.assemble() compose layers in registration order with separator?
//   2. Does PromptStack skip empty-render layers?
//   3. Does discernment-gate evaluate-output return 'pass' on grounded output?
//   4. Does discernment-gate return 'block' on ungrounded output?
//   5. Does V2 actually install the substrate (boot wires SubstrateInstaller into engine.modelRouter)?
//   6. Does V2 register the 7 expected layers?

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import {
  PromptStack,
  LawsLayer,
  RealityLayer,
  evaluateOutput,
} from 'runcor-substrate';
import type { PromptLayer, LayerContext, RealitySlice } from 'runcor-substrate';

class StubLayer implements PromptLayer {
  constructor(public name: string, private body: string | null) {}
  render(_c: LayerContext): string | null { return this.body; }
}

const ctx: LayerContext = {
  cycle: 100,
  agentRole: 'v2',
  baseRequest: { prompt: '' },
  drives: { resource: 0.3, curiosity: 0.5, reactivity: 0.0, coherence: 0.0, dominant: { label: 'curiosity', value: 0.5 } },
  topGoal: null,
  identitySelfTheory: null,
  lastPlanPrecis: null,
  recalledNodes: [],
  realitySlice: null,
  capabilityList: [],
};

async function main() {
  console.log('[probe-06] runcor-substrate — prompt-stack + discernment gate\n');
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // ── Phase 1: PromptStack assembles in order ──
  console.log('=== Phase 1: PromptStack.assemble() ordering ===');
  const stack1 = new PromptStack([
    new StubLayer('first', 'AAA'),
    new StubLayer('second', 'BBB'),
    new StubLayer('third', 'CCC'),
  ]);
  const out1 = stack1.assemble(ctx);
  console.log(`  assembled:\n    ${out1.replace(/\n/g, '\\n')}`);
  checks.push({ name: 'layers appear in registration order', pass: out1.indexOf('AAA') < out1.indexOf('BBB') && out1.indexOf('BBB') < out1.indexOf('CCC') });

  // ── Phase 2: empty layers skipped ──
  console.log('\n=== Phase 2: empty-layer skipping ===');
  const stack2 = new PromptStack([
    new StubLayer('a', 'AAA'),
    new StubLayer('b-empty', ''),
    new StubLayer('c-null', null),
    new StubLayer('d', 'DDD'),
  ]);
  const out2 = stack2.assemble(ctx);
  const nonEmpty = stack2.nonEmptyLayerNames(ctx);
  console.log(`  layerNames(): ${stack2.layerNames().join(', ')}`);
  console.log(`  nonEmptyLayerNames(ctx): ${nonEmpty.join(', ')}`);
  console.log(`  assembled has AAA: ${out2.includes('AAA')}, BBB-empty appears: ${out2.includes('b-empty')}, DDD: ${out2.includes('DDD')}`);
  checks.push({ name: 'empty layers skipped from assembled output', pass: nonEmpty.length === 2 && !out2.includes('b-empty') });

  // ── Phase 3: discernment-gate pass on grounded output ──
  console.log('\n=== Phase 3: discernment-gate "pass" on grounded output ===');
  const groundedReality: RealitySlice = {
    entities: [
      { id: 'abc12345-1234-1234-1234-123456789abc', entity_type: 'company', name: 'runcor', structured: {} } as unknown as RealitySlice['entities'][0],
    ],
    relevantEdges: [],
    openConflicts: [],
    rendered: 'company runcor exists',
  };
  const goodOutput = `Based on the company "runcor", I'll send an introduction email to a prospect.`;
  const r1 = await evaluateOutput({ input: 'plan next action', output: goodOutput, realitySlice: groundedReality });
  console.log(`  outcome=${r1.outcome} failed=${r1.checks.filter(c => !c.passed).length}/${r1.checks.length}`);
  console.log(`  reason: ${r1.reason ?? '(none)'}`);
  checks.push({ name: 'pass on grounded output', pass: r1.outcome === 'pass' });

  // ── Phase 4: discernment-gate block on ungrounded entity reference ──
  console.log('\n=== Phase 4: discernment-gate "block" on ungrounded entity reference ===');
  const badOutput = `I'll send a follow-up to entity 00000000-1234-1234-1234-deadbeefcafe based on prior research.`;
  const r2 = await evaluateOutput({ input: 'plan next action', output: badOutput, realitySlice: groundedReality });
  console.log(`  outcome=${r2.outcome} failed=${r2.checks.filter(c => !c.passed).length}/${r2.checks.length}`);
  console.log(`  reason: ${r2.reason ?? '(none)'}`);
  checks.push({ name: 'block on ungrounded entity reference', pass: r2.outcome === 'block' });

  // ── Phase 5: V2 wiring audit ──
  console.log('\n=== Phase 5: V2 wiring audit ===');
  const bootSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/boot/boot.ts', 'utf8');
  const installs = /substrate\.installer\.install\s*\(/.test(bootSrc);
  const promptStackCreated = /new\s+Substrate\s*\(/.test(bootSrc);
  // Count layers registered in boot.ts
  const layerMatches = [
    /new\s+LawsLayer/.test(bootSrc),
    /new\s+V2RealityLayer/.test(bootSrc) || /new\s+RealityLayer/.test(bootSrc),
    /new\s+DrivesLayer/.test(bootSrc),
    /new\s+GoalsLayer/.test(bootSrc),
    /new\s+IdentityLayer/.test(bootSrc),
    /new\s+CapabilitiesLayer/.test(bootSrc),
    /new\s+MemoryRecallLayer/.test(bootSrc),
  ];
  const layerCount = layerMatches.filter(Boolean).length;
  console.log(`  V2 boot.ts creates Substrate: ${promptStackCreated ? 'YES' : 'NO'}`);
  console.log(`  V2 boot.ts installs substrate (monkey-patch modelRouter): ${installs ? 'YES' : 'NO'}`);
  console.log(`  V2 boot.ts registers 7 expected layers: ${layerCount}/7`);
  console.log(`     [Laws, Reality, Drives, Goals, Identity, Capabilities, MemoryRecall]`);
  console.log(`     [${layerMatches.map(b => b ? '✓' : '✗').join(', ')}]`);
  checks.push({ name: 'V2 creates Substrate', pass: promptStackCreated });
  checks.push({ name: 'V2 installs substrate (monkey-patches engine)', pass: installs });
  checks.push({ name: 'V2 registers all 7 expected layers', pass: layerCount >= 7 });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'substrate functions + V2 wires correctly' : 'see failures'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
