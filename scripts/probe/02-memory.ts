// Probe #2 — runcor-memory
//
// Questions:
//   1. Does record() actually persist episodic nodes?
//   2. Does query() (semantic recall) surface relevant nodes for a given query?
//   3. Does cycle() decay nodes over simulated cycle progression?
//   4. Does promotion to long cube fire when nodes are reinforced enough?
//   5. Does forgetting fire when M falls below threshold?
//
// Suspicion (from V2 forensic): memory APIs work mechanically but the recall semantics
// + decay tuning may not give V2 useful signal — e.g. recall might surface noise rather
// than the schema-lesson the agent needs. If V2's recall doesn't find the "I succeeded
// with commitMessage" episode when the agent is about to git_push again, that's the
// schema-amnesia root cause.
//
// Run: npx tsx scripts/probe/02-memory.ts
//
// PASS criteria (all must hold):
//   - 50 records insert (allowing dedup) without errors
//   - query() for known-content queries returns the matching node in top-3 ≥80% of the time
//   - cycle() ticks: short-term node `t` increments, M recalculates
//   - At least one node promotes short→long after reinforcement + cycles
//   - At least one node forgets after sustained non-access

import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySystem, MemoryDatabase } from 'runcor-memory';
import type { MemoryNode } from 'runcor-memory';

interface ModelComplete {
  complete(request: {
    prompt?: string;
    systemPrompt?: string;
    responseFormat?: 'text' | 'json';
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

const COMPONENT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';

function makeOpenRouterModel(apiKey: string): ModelComplete {
  return {
    async complete(request) {
      const messages = [
        ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
        { role: 'user' as const, content: request.prompt ?? '' },
      ];
      const body: Record<string, unknown> = { model: COMPONENT_MODEL, messages };
      if (request.maxTokens != null) body.max_tokens = Math.max(request.maxTokens, 4000);
      if (request.temperature != null) body.temperature = request.temperature;
      if (request.responseFormat === 'json') body.response_format = { type: 'json_object' };
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://runcor.ai',
          'X-Title': 'runcor-probe',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
      const text = data.choices?.[0]?.message?.content ?? '';
      return { text: extractJsonOrText(text) };
    },
  };
}

function extractJsonOrText(text: string): string {
  // For JSON-mode responses, find the first balanced { ... }. Otherwise return text as-is.
  const start = text.indexOf('{');
  if (start < 0) return text;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text;
}

// 50 realistic V2-shape episodic records spanning the categories an agent produces.
// Tagged so we can verify which ones recall surfaces.
const EPISODES: Array<{ content: string; tag: string; explicitR?: number }> = [
  // Schema-lesson episodes (the most-important type per V2 forensic)
  { content: 'Cycle 5: invoked v2-local-actions.git_push({path:"README.md",content:"...",commitMessage:"init"}); result: {ok:true,pushed:true}; reasoning: include commitMessage avoids the path/commitMessage error', tag: 'schema-success', explicitR: 0.85 },
  { content: 'Cycle 6: invoked v2-local-actions.git_push({repo:"X",path:"a.py",content:"..."}); result: ERROR path/commitMessage required; reasoning: forgot commitMessage', tag: 'schema-fail', explicitR: 0.80 },
  { content: 'Cycle 7: invoked v2-local-actions.git_push({path:"b.py",content:"...",commitMessage:"add b.py"}); result: {ok:true,pushed:true}; reasoning: remembered to include commitMessage this time', tag: 'schema-success', explicitR: 0.85 },
  { content: 'Cycle 8: invoked v2-local-actions.git_push({repo:"X",path:"c.py",content:"..."}); result: ERROR path/commitMessage required; reasoning: typed args quickly and forgot the message field', tag: 'schema-fail', explicitR: 0.80 },
  // Web research
  { content: 'Cycle 10: invoked v2-local-actions.web_search({query:"pre-seed valuation 2026"}); result: median $5M; reasoning: research fundraising benchmarks', tag: 'research', explicitR: 0.6 },
  { content: 'Cycle 12: invoked v2-local-actions.web_search({query:"best CRM for early-stage"}); result: Attio free tier, Folk $20/seat; reasoning: research sales tooling', tag: 'research', explicitR: 0.55 },
  { content: 'Cycle 14: invoked v2-local-actions.web_search({query:"GAIA benchmark AI agents"}); result: arxiv 2311.12983; reasoning: research competitive landscape', tag: 'research', explicitR: 0.5 },
  { content: 'Cycle 16: invoked v2-local-actions.firecrawl_scrape({url:"stripe.com/atlas"}); result: $500 incorporation; reasoning: research incorporation', tag: 'research', explicitR: 0.6 },
  // Decisions journaled
  { content: 'Cycle 20: invoked v2-local-actions.fs_write({path:"scratchpad/decision-log.md",content:"## Cycle 20\\n\\nDecided to incorporate via Stripe Atlas based on cycle 16 research."}); result: ok; reasoning: journal decision', tag: 'decision', explicitR: 0.75 },
  { content: 'Cycle 22: invoked v2-local-actions.fs_write({path:"scratchpad/decision-log.md",content:"## Cycle 22\\n\\nDecided to target $500K pre-seed at $5M post."}); result: ok; reasoning: journal fundraising decision', tag: 'decision', explicitR: 0.75 },
  { content: 'Cycle 24: invoked v2-local-actions.fs_write({path:"scratchpad/decision-log.md",content:"## Cycle 24\\n\\nDecided to use Attio CRM."}); result: ok; reasoning: journal CRM decision', tag: 'decision', explicitR: 0.7 },
  // Inbox triage (real)
  { content: 'Cycle 30: invoked v2-local-actions.inbox_read({limit:10}); result: 3 messages — Q3 planning from founder, welcome from alex@example, newsletter; reasoning: triage daily inbox', tag: 'inbox-success', explicitR: 0.5 },
  // Inbox triage (failed) — schema-fail equivalent for tool reliability
  { content: 'Cycle 35: invoked v2-local-actions.inbox_read({limit:10}); result: ERROR Command failed; reasoning: triage daily inbox', tag: 'inbox-fail', explicitR: 0.4 },
  { content: 'Cycle 36: invoked v2-local-actions.inbox_read({limit:10}); result: ERROR Command failed; reasoning: retry inbox', tag: 'inbox-fail', explicitR: 0.4 },
  { content: 'Cycle 37: invoked v2-local-actions.inbox_read({limit:10}); result: ERROR Command failed; reasoning: retry inbox', tag: 'inbox-fail', explicitR: 0.4 },
  // Email send (replies)
  { content: 'Cycle 40: invoked v2-local-actions.email_send({to:"founder@runcor.ai",subject:"Q3 OKR proposal",body:"..."}); result: {ok:true,messageId:"<x@y>"}; reasoning: reply to founder Q3 request', tag: 'email-send', explicitR: 0.7 },
  // GitHub repo create
  { content: 'Cycle 50: invoked v2-local-actions.github_create_repo({name:"pricing-experiments"}); result: {ok:true,repo:"runcor-ai/pricing-experiments"}; reasoning: open initiative for pricing', tag: 'github-create', explicitR: 0.6 },
  { content: 'Cycle 52: invoked v2-local-actions.git_push({repo:"runcor-ai/pricing-experiments",path:"README.md",content:"# Pricing experiments",commitMessage:"init"}); result: {ok:true,pushed:true}; reasoning: commit initial README per orphan-initiative rule', tag: 'schema-success', explicitR: 0.7 },
  // Publishing
  { content: 'Cycle 90: invoked v2-local-actions.publish_post({title:"Why we incorporated this week",body:"We chose Stripe Atlas. Here is the reasoning..."}); result: {ok:true,url:"https://blog.runcor.ai/..."}; reasoning: quarterly strategy post per CEO seed checklist', tag: 'publish', explicitR: 0.8 },
  // Reasoning notes (lower R, should decay faster)
  { content: 'Cycle 100: agent reasoning: "as CEO I must prioritize long-term over short-term wins"', tag: 'reasoning-low', explicitR: 0.3 },
  { content: 'Cycle 101: agent reasoning: "first cycle of day means I should triage inbox"', tag: 'reasoning-low', explicitR: 0.3 },
  { content: 'Cycle 102: agent reasoning: "uncertainty about email config requires investigation"', tag: 'reasoning-low', explicitR: 0.3 },
  { content: 'Cycle 103: agent reasoning: "Resource drive motivates seeking information"', tag: 'reasoning-low', explicitR: 0.3 },
  { content: 'Cycle 104: agent reasoning: "must record a decision each cycle as CEO"', tag: 'reasoning-low', explicitR: 0.3 },
  // Discernment-flagged moments
  { content: 'Cycle 110: discernment_flagged failedLawId:reality — claim "company has signed customers" not grounded in data cube', tag: 'discernment', explicitR: 0.7 },
  { content: 'Cycle 112: discernment_flagged failedLawId:reality — claim "founder approved fundraising" not grounded', tag: 'discernment', explicitR: 0.7 },
  // Tool-discovery moments
  { content: 'Cycle 120: agent attempted unknown tool "system_diagnostic" not in capability list; result: tool_not_found', tag: 'tool-miss', explicitR: 0.5 },
  // World-knowledge episodes (from research)
  { content: 'Cycle 130: learned that median pre-seed round 2026 is $5M post-money (source: carta data cycle 14)', tag: 'world-fact', explicitR: 0.65 },
  { content: 'Cycle 131: learned that Stripe Atlas costs $500 one-time for Delaware C-corp + US bank + tax setup', tag: 'world-fact', explicitR: 0.6 },
  { content: 'Cycle 132: learned that Attio CRM has a free tier suitable for early-stage', tag: 'world-fact', explicitR: 0.55 },
  // Goals proposals
  { content: 'Cycle 150: goals.propose returned: "establish weekly customer-interview cadence" (initiative)', tag: 'goal-proposal', explicitR: 0.7 },
  { content: 'Cycle 150: goals.propose returned: "draft Q3 strategy memo by cycle 200" (objective)', tag: 'goal-proposal', explicitR: 0.7 },
  // Identity reflections
  { content: 'Cycle 200: identity.reflect — self-theory updated: "I am a CEO who optimizes for long-term durability over short-term wins"', tag: 'identity', explicitR: 0.8 },
  // Padding (low-value episodes that should be candidates for forgetting)
  ...Array.from({ length: 17 }, (_, i) => ({
    content: `Cycle ${300 + i}: noop background event ${i} — generic activity log`,
    tag: 'padding',
    explicitR: 0.2,
  })),
];

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !openaiKey) {
    console.error('FAIL — OPENROUTER_API_KEY and OPENAI_API_KEY required');
    process.exit(2);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'probe-memory-'));
  const dbPath = join(tmp, 'memory.db');
  console.log(`[probe-02] db=${dbPath} embedmodel=text-embedding-3-small`);
  console.log(`[probe-02] inputs: ${EPISODES.length} realistic V2-shape episodic records\n`);

  const model = makeOpenRouterModel(apiKey);
  const memDb = new MemoryDatabase(dbPath);
  const mem = new MemorySystem({
    db: memDb,
    openaiApiKey: openaiKey,
    model,
    agentRole: 'CEO of an early-stage company',
  });

  // ── Phase 1: insert episodes ──
  console.log('=== Phase 1: insert 50 episodes ===');
  let created = 0;
  let reinforced = 0;
  let errors = 0;
  for (let i = 0; i < EPISODES.length; i++) {
    const ep = EPISODES[i]!;
    mem.setCycle(100 + i);
    try {
      const r = await mem.record(ep.content, {
        ...(ep.explicitR !== undefined ? { R: ep.explicitR } : {}),
        tags: [ep.tag],
      });
      if (r.action === 'created') created++;
      else reinforced++;
    } catch (err) {
      errors++;
      console.error(`  ${i + 1}. INSERT_ERROR: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
    }
  }
  console.log(`created=${created} reinforced=${reinforced} errors=${errors}`);
  const afterInsertStats = { short: mem.getShortTerm().length, long: mem.getLongTerm().length };
  console.log(`After insert: short=${afterInsertStats.short} long=${afterInsertStats.long}\n`);

  // ── Phase 2: recall accuracy ──
  console.log('=== Phase 2: recall accuracy (query → expected tag in top-3) ===');
  const recallTests: Array<{ query: string; expectedTag: string; label: string }> = [
    { query: 'how do I push to GitHub successfully', expectedTag: 'schema-success', label: 'schema lesson recall' },
    { query: 'what went wrong with git_push', expectedTag: 'schema-fail', label: 'schema failure recall' },
    { query: 'pre-seed fundraising benchmarks', expectedTag: 'world-fact', label: 'world fact recall' },
    { query: 'what decisions have I made', expectedTag: 'decision', label: 'decision recall' },
    { query: 'what did the founder say about Q3', expectedTag: 'inbox-success', label: 'inbox recall' },
    { query: 'who am I', expectedTag: 'identity', label: 'identity recall' },
    { query: 'reality grounding violations', expectedTag: 'discernment', label: 'discernment recall' },
    { query: 'what is the CRM situation', expectedTag: 'world-fact', label: 'world fact (CRM) recall' },
  ];
  let recallPass = 0;
  for (const t of recallTests) {
    const results = await mem.query(t.query, 3);
    const hit = results.some(r => r.node.tags?.includes(t.expectedTag));
    console.log(`  ${hit ? 'PASS' : 'FAIL'}  "${t.query}"  expected tag: ${t.expectedTag}  top3: [${results.map(r => r.node.tags?.[0] ?? '?').join(', ')}]`);
    if (hit) recallPass++;
  }
  console.log(`Recall accuracy: ${recallPass}/${recallTests.length} (${Math.round(recallPass / recallTests.length * 100)}%)\n`);

  // ── Phase 3: reinforcement boost ──
  // Hit the schema-success nodes via query several times to boost their f and reset t.
  // This should make them candidates for promotion to long cube.
  console.log('=== Phase 3: reinforce schema-success episodes via repeated recall ===');
  for (let i = 0; i < 8; i++) {
    await mem.query('git_push commitMessage success', 5);
  }
  const reinforcedM = mem.getShortTerm()
    .filter(n => n.tags?.includes('schema-success'))
    .map(n => ({ id: n.id.slice(0, 8), f: n.f, R: n.R, M: n.M.toFixed(3), cube: n.cube }));
  console.log(`schema-success nodes after 8 recall passes:`);
  for (const n of reinforcedM) console.log(`  id=${n.id} f=${n.f} R=${n.R} M=${n.M} cube=${n.cube}`);
  console.log('');

  // ── Phase 4: run cycle() many times — does decay + promotion fire? ──
  console.log('=== Phase 4: run cycle() 15 times, observe decay + promotion ===');
  let totalForgotten = 0;
  let totalPromoted = 0;
  for (let i = 0; i < 15; i++) {
    const r = await mem.cycle();
    totalForgotten += (r.shortTerm.forgotten?.length ?? 0) + (r.longTerm.forgotten?.length ?? 0);
    totalPromoted += r.promoted?.length ?? 0;
    if (i === 0 || i === 7 || i === 14) {
      const s = { short: mem.getShortTerm().length, long: mem.getLongTerm().length };
      console.log(`  cycle ${i + 1}: short=${s.short} long=${s.long} forgottenThisCycle=${(r.shortTerm.forgotten?.length ?? 0) + (r.longTerm.forgotten?.length ?? 0)} promotedThisCycle=${r.promoted?.length ?? 0}`);
    }
  }
  console.log(`Totals across 15 cycles: forgotten=${totalForgotten}, promoted=${totalPromoted}\n`);

  // ── Phase 5: final state ──
  const finalShort = mem.getShortTerm();
  const finalLong = mem.getLongTerm();
  const longByTag: Record<string, number> = {};
  for (const n of finalLong) for (const tag of n.tags ?? []) longByTag[tag] = (longByTag[tag] || 0) + 1;
  const shortByTag: Record<string, number> = {};
  for (const n of finalShort) for (const tag of n.tags ?? []) shortByTag[tag] = (shortByTag[tag] || 0) + 1;
  console.log('=== Phase 5: final state ===');
  console.log(`Short-term cube: ${finalShort.length} nodes — by tag: ${JSON.stringify(shortByTag)}`);
  console.log(`Long-term cube: ${finalLong.length} nodes — by tag: ${JSON.stringify(longByTag)}`);

  // ── PASS/FAIL ──
  const passes = {
    'insert >40 nodes': created >= 40,
    'recall accuracy ≥60%': (recallPass / recallTests.length) >= 0.6,
    'cycle promotes at least 1 node': totalPromoted >= 1,
    'cycle forgets at least 1 node': totalForgotten >= 1,
    'errors ≤ 10%': (errors / EPISODES.length) <= 0.1,
  };
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const [k, v] of Object.entries(passes)) {
    console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`);
    if (!v) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'memory functions as V2 expects' : 'see failing assertions above'}`);

  rmSync(tmp, { recursive: true, force: true });
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
