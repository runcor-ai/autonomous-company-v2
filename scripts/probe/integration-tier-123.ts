// Integration probe — verify Tiers 1+2+3 wiring without spinning up V2's cycle loop.
//
// Cost: ZERO LLM completion calls. ~$0.001 of OpenAI text-embedding-3-small for the memory
// section (50 records + a few queries × ~$0.00002 each).
//
// Sections:
//   1. Tier 1 — DataCube V2-action extractor: 20 ingests, expect 40+ entities + 20+ edges
//   2. Tier 2.1 — Goals.decayStep retires goals as expected
//   3. Tier 2.2 — Drives compute non-zero reactivity + coherence from real inputs
//   4. Tier 2.3 — WatchdogLayer renders findings into prompt-stack output
//   5. Tier 3 — Memory.query() bumps `f`; cycle() promotes high-f nodes to long cube
//
// Each section logs PASS/FAIL. Exit code 0 = all pass.

import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataCube } from 'runcor-data';
import { Goals } from 'runcor-goals';
import { Identity } from 'runcor-identity';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import { Watchdog } from 'runcor-watchdog';
import { computeDrives } from 'runcor-drives';
import type { LayerContext } from 'runcor-substrate';
import { WatchdogLayer } from '../../src/substrate-layers/watchdog.js';

const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

function pass(name: string): void { checks.push({ name, pass: true }); }
function fail(name: string, detail?: string): void { checks.push({ name, pass: false, detail }); }

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('FAIL — OPENAI_API_KEY required (for memory embeddings)'); process.exit(2); }
  const tmp = mkdtempSync(join(tmpdir(), 'integration-probe-'));
  console.log(`[integration-probe] tmp=${tmp}\n`);

  // ───────────────────────────────────────────────────────────────────────
  // SECTION 1: Tier 1 — DataCube V2-action extractor
  // ───────────────────────────────────────────────────────────────────────
  console.log('=== SECTION 1: Tier 1 — DataCube V2-action extractor (no LLM) ===');
  const cube = new DataCube({ dbPath: join(tmp, 'data.db') }); // model: undefined → V2-fast-path only
  const ingests = [
    { source: 'v2-local-actions.github_create_repo', payload: { args: { name: 'pricing-test' }, result: '{"ok":true,"repo":"runcor-ai/pricing-test","url":"https://github.com/runcor-ai/pricing-test"}', reasoning: 'open initiative' } },
    { source: 'v2-local-actions.git_push', payload: { args: { repo: 'runcor-ai/pricing-test', path: 'README.md', content: '# Pricing', commitMessage: 'init' }, result: '{"ok":true,"pushed":true,"path":"README.md"}', reasoning: 'first commit' } },
    { source: 'v2-local-actions.web_search', payload: { args: { query: 'pre-seed valuation 2026' }, result: '{"ok":true,"results":[{"title":"Carta data","snippet":"$5M median","url":"https://carta.com/x"},{"title":"Y Combinator","snippet":"Variable","url":"https://ycombinator.com/y"}]}', reasoning: 'research' } },
    { source: 'v2-local-actions.firecrawl_scrape', payload: { args: { url: 'https://carta.com/x' }, result: '{"ok":true,"title":"Carta data","markdown":"Pre-seed median: $5M post-money."}', reasoning: 'pull source' } },
    { source: 'v2-local-actions.fs_write', payload: { args: { path: 'scratchpad/decision-log.md', content: '## Cycle 5\nDecided to target $5M post.' }, result: '{"ok":true,"bytesWritten":42}', reasoning: 'journal decision' } },
    { source: 'v2-local-actions.email_send', payload: { args: { to: 'founder@runcor.ai', subject: 'Q3 OKRs', body: 'Proposing...' }, result: '{"ok":true,"messageId":"<x@y>"}', reasoning: 'reply to founder' } },
    { source: 'v2-local-actions.inbox_read', payload: { args: { limit: 5 }, result: '{"ok":true,"count":2,"messages":[{"subject":"Welcome","from":"alex@x","date":"2026-05-18","body":"Hi"},{"subject":"Q3","from":"founder@runcor.ai","date":"2026-05-17","body":"Plan"}]}', reasoning: 'triage' } },
    { source: 'v2-local-actions.publish_post', payload: { args: { title: 'Why $5M post', body: 'Reasoning...' }, result: '{"ok":true,"url":"https://blog/x","slug":"why-5m-post"}', reasoning: 'thought-leadership' } },
  ];
  for (let i = 0; i < ingests.length; i++) {
    await cube.ingest({ cycle: 10 + i, source: ingests[i]!.source, payload: ingests[i]!.payload });
  }
  // Ingest a duplicate repo creation to test dedup
  await cube.ingest({ cycle: 20, source: 'v2-local-actions.git_push', payload: { args: { repo: 'runcor-ai/pricing-test', path: 'README.md', content: '# Pricing v2', commitMessage: 'update' }, result: '{"ok":true,"pushed":true,"path":"README.md"}', reasoning: 'amend' } });
  const stats = cube.getStats();
  console.log(`  ingests=${ingests.length + 1} entities=${stats.entities} edges=${stats.edges}`);
  console.log(`  entity types: ${[...new Set((cube as unknown as { db: { getAllNodes(): Array<{ entity_type: string; structured: unknown }> } }).db.getAllNodes().map(n => n.entity_type))].sort().join(', ')}`);
  if (stats.entities >= 20) pass('Tier 1 — DataCube populates (≥20 entities from 9 ingests)');
  else fail('Tier 1 — DataCube populates', `only got ${stats.entities} entities`);
  if (stats.edges >= 10) pass('Tier 1 — DataCube creates edges (≥10)');
  else fail('Tier 1 — DataCube creates edges', `only got ${stats.edges} edges`);
  const types = new Set((cube as unknown as { db: { getAllNodes(): Array<{ entity_type: string; structured: unknown }> } }).db.getAllNodes().map(n => n.entity_type));
  if (types.has('github_repo') && types.has('github_file') && types.has('webpage') && types.has('email_message')) pass('Tier 1 — real entity types (github_repo, github_file, webpage, email_message)');
  else fail('Tier 1 — real entity types', `got: ${[...types].join(',')}`);
  // Dedup check: there should be ONE github_file entity for README.md (not two)
  const readmeFiles = cube.getByType('github_file').filter(n => (n.structured as { path?: string }).path === 'README.md');
  if (readmeFiles.length === 1) pass('Tier 1 — dedup: duplicate git_push merged into one github_file');
  else fail('Tier 1 — dedup', `got ${readmeFiles.length} README files`);

  // ───────────────────────────────────────────────────────────────────────
  // SECTION 2: Tier 2.1 — goals.decayStep retires goals
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n=== SECTION 2: Tier 2.1 — goals.decayStep ===');
  const goals = new Goals({ dbPath: join(tmp, 'goals.db') });
  goals.accept({ text: 'initiative test', level: 'initiative' }, { currentCycle: 100 });
  const beforeRetire = goals.active().length;
  // Per decay logic: initiative cadence=5, retirement threshold=0.20.
  // After ~12 cycles past last reinforcement (5 + ~7 of decay), intensity drops below 0.20.
  for (let c = 100; c <= 130; c++) goals.decayStep(c);
  const afterRetire = goals.active().length;
  console.log(`  active before decay: ${beforeRetire}, after 30 cycles of decayStep: ${afterRetire}`);
  if (beforeRetire === 1 && afterRetire === 0) pass('Tier 2.1 — goals.decayStep retires unreinforced initiative within 30 cycles');
  else fail('Tier 2.1 — goals.decayStep retires', `before=${beforeRetire} after=${afterRetire}`);
  goals.close();

  // ───────────────────────────────────────────────────────────────────────
  // SECTION 3: Tier 2.2 — Drives compute real reactivity + coherence
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n=== SECTION 3: Tier 2.2 — Drives with real reactivity + coherence inputs ===');
  // Simulate the kind of inputs captureDrivePressure now produces.
  const drives = computeDrives({
    resource: { remaining: 4, total: 5, burnPerCycle: 0.01, cyclesUsed: 100 },
    curiosity: { exploredAreas: ['ai', 'finance'], knownAreas: ['ai', 'finance', 'marketing', 'product', 'sales'], recentExplorationCycles: 10 },
    reactivity: { pendingEvents: [
      { kind: 'discernment_flag_burst', urgency: 'high', age: 0 },
      { kind: 'execution_failed', urgency: 'medium', age: 2 },
    ] },
    coherence: { selfTheoryClaims: ['I journal every decision', 'I never use email'], recentActions: [{ action: 'fs_write decision-log.md', confidence: 0.9 }, { action: 'email_send to founder', confidence: 0.7 }] },
  });
  console.log(`  resource=${drives.resource?.intensity.toFixed(2)} curiosity=${drives.curiosity?.intensity.toFixed(2)} reactivity=${drives.reactivity?.intensity.toFixed(2)} coherence=${drives.coherence?.intensity.toFixed(2)}`);
  console.log(`  dominant=${drives.dominantDrive} @ ${drives.maxIntensity.toFixed(2)}`);
  if ((drives.reactivity?.intensity ?? 0) > 0) pass('Tier 2.2 — reactivity > 0 with real pending events');
  else fail('Tier 2.2 — reactivity > 0', `got ${drives.reactivity?.intensity}`);
  if ((drives.coherence?.intensity ?? 0) > 0) pass('Tier 2.2 — coherence > 0 with mismatching claims/actions');
  else fail('Tier 2.2 — coherence > 0', `got ${drives.coherence?.intensity}`);

  // ───────────────────────────────────────────────────────────────────────
  // SECTION 4: Tier 2.3 — WatchdogLayer renders findings
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n=== SECTION 4: Tier 2.3 — WatchdogLayer renders into prompt stack ===');
  const memDb = new MemoryDatabase(join(tmp, 'mem.db'));
  const mem = new MemorySystem({ db: memDb, openaiApiKey: apiKey });
  // Insert a watchdog-finding-shaped memory node (same shape side-effects.ts writes)
  await mem.record(
    'Watchdog: unused-capability-matching-stated-problem — "I need to email the founder about Q3" (capability: email_send). Validated: false.',
    { tags: ['watchdog_finding', 'open'], R: 0.6 },
  );
  await mem.record(
    'Watchdog: repeated-research-without-execution — "I need to figure out fundraising" (capability: publish_post). Validated: false.',
    { tags: ['watchdog_finding', 'open'], R: 0.6 },
  );
  // Plus a 'dismissed' finding that should NOT render
  await mem.record(
    'Watchdog: unused-capability-matching-stated-problem — "Some other thing" (capability: web_search). Validated: false.',
    { tags: ['watchdog_finding', 'dismissed'], R: 0.4 },
  );
  const watchdogLayer = new WatchdogLayer(mem);
  const dummyCtx: LayerContext = {
    cycle: 50, agentRole: 'v2', baseRequest: { prompt: '' },
    drives: { resource: 0, curiosity: 0, reactivity: 0, coherence: 0, dominant: { label: 'resource', value: 0 } },
    topGoal: null, identitySelfTheory: null, lastPlanPrecis: null, recalledNodes: [], realitySlice: null, capabilityList: [],
  };
  const rendered = watchdogLayer.render(dummyCtx);
  console.log('  rendered:');
  for (const l of rendered.split('\n')) console.log('    ' + l);
  if (rendered.includes('email_send') && rendered.includes('publish_post')) pass('Tier 2.3 — WatchdogLayer renders open findings');
  else fail('Tier 2.3 — WatchdogLayer renders open findings', `output: ${rendered.slice(0, 200)}`);
  if (!rendered.includes('web_search')) pass('Tier 2.3 — WatchdogLayer skips dismissed findings');
  else fail('Tier 2.3 — WatchdogLayer skips dismissed', 'dismissed leaked into render');

  // ───────────────────────────────────────────────────────────────────────
  // SECTION 5: Tier 3 — memory.query bumps f; cycle promotes high-f nodes
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n=== SECTION 5: Tier 3 — memory.query bumps f + promotion fires ===');
  // Record a high-R "schema lesson" then recall it 5 times — should promote.
  const r1 = await mem.record('schema lesson: include commitMessage when calling git_push to avoid path/commitMessage required error', { tags: ['schema-success'], R: 0.85 });
  const nodeIdBefore = r1.nodeId;
  const beforeF = mem.getShortTerm().find(n => n.id === nodeIdBefore)?.f ?? 0;
  // Recall 5 times to bump f
  for (let i = 0; i < 5; i++) await mem.query('how do I git_push successfully', 3);
  const afterRecallF = mem.getShortTerm().find(n => n.id === nodeIdBefore)?.f ?? 0;
  const afterRecallM = mem.getShortTerm().find(n => n.id === nodeIdBefore)?.M ?? 0;
  console.log(`  schema-lesson node: f before=${beforeF} after 5 recalls=${afterRecallF} M=${afterRecallM.toFixed(3)}`);
  if (afterRecallF > beforeF) pass(`Tier 3 — query() bumps f (${beforeF}→${afterRecallF})`);
  else fail('Tier 3 — query() bumps f', `f stayed at ${beforeF}`);

  // Run cycles — high-M node should promote
  let totalPromoted = 0;
  for (let i = 0; i < 5; i++) {
    const r = await mem.cycle();
    totalPromoted += r.promoted?.length ?? 0;
  }
  const longCubeAfter = mem.getLongTerm();
  console.log(`  long cube after 5 cycle()s: ${longCubeAfter.length} nodes (promoted ${totalPromoted})`);
  if (longCubeAfter.length >= 1) pass('Tier 3 — high-f memory promotes to long cube');
  else fail('Tier 3 — promotion fires', `long cube has ${longCubeAfter.length} nodes`);

  // Reinforce API
  const r2 = await mem.record('a candidate for explicit reinforcement', { tags: ['test'], R: 0.5 });
  const beforeReinforceF = mem.getShortTerm().find(n => n.id === r2.nodeId)?.f ?? 0;
  const reinforced = mem.reinforce(r2.nodeId, 3);
  const afterReinforceF = mem.getShortTerm().find(n => n.id === r2.nodeId)?.f ?? 0;
  console.log(`  reinforce(${r2.nodeId.slice(0, 8)}, 3): returned ${reinforced}, f ${beforeReinforceF}→${afterReinforceF}`);
  if (reinforced && afterReinforceF === beforeReinforceF + 3) pass('Tier 3 — explicit reinforce(id, amount) bumps f by amount');
  else fail('Tier 3 — explicit reinforce', `returned=${reinforced} f=${beforeReinforceF}→${afterReinforceF}`);

  // ───────────────────────────────────────────────────────────────────────
  // RESULT
  // ───────────────────────────────────────────────────────────────────────
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'INTEGRATION PROBE PASS' : 'INTEGRATION PROBE FAIL'} — Tiers 1+2+3 wiring ${allPass ? 'verified end-to-end' : 'has gaps'}`);

  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows file-locking — fine */ }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
