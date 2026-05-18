// Probe #1 — runcor-data DataCube
//
// Question: when V2's side-effects pipeline calls dataCube.ingest() with the payloads
// it actually produces (action+args+resultSummary+reasoning), does the cube populate
// entities at the rate the readiness gates expect (≥10 entities for goal proposal,
// ≥15 for identity reflection)?
//
// Suspicion (from forensic audit): the answer is NO — V2's actions like git_push
// fail with "path/commitMessage required" and have nothing extractable; even successful
// actions like "fs_write" don't surface as entities. If confirmed, this is the root
// cause for goals + identity staying dormant forever.
//
// Run: npx tsx scripts/probe/01-data-cube.ts
//
// Inputs: 20 realistic cycle results sampled from actual V2 archive behavior
// PASS criteria: getStats().entities >= 10 after 20 ingests
// FAIL output: per-ingest breakdown of what was extracted vs dropped

import 'dotenv/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataCube } from 'runcor-data';

interface ModelComplete {
  complete(request: {
    prompt?: string;
    systemPrompt?: string;
    responseFormat?: 'text' | 'json';
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

// Mirror the COMPONENT_MODEL from boot.ts — same model V2 uses for extraction.
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
      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }
      const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
      // Component pipelines parse the response as JSON. Light extraction wrapper to handle prose-wrapped JSON.
      const text = data.choices?.[0]?.message?.content ?? '';
      return { text: extractJson(text) ?? text };
    },
  };
}

function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
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
  return text.slice(start) + '"}'.repeat(Math.max(0, depth));
}

// 20 realistic cycle inputs sampled from actual V2 archive patterns.
// Mix: successful tool calls, failed tool calls, JSON-shaped results, prose results.
const SAMPLE_INGESTS: Array<{ source: string; payload: { args: unknown; result: string; reasoning: string } }> = [
  {
    source: 'v2-local-actions.github_create_repo',
    payload: { args: { name: 'startup-initiative-cycle190' }, result: '{"ok":true,"created":true,"repo":"runcor-ai/startup-initiative-cycle190","url":"https://github.com/runcor-ai/startup-initiative-cycle190"}', reasoning: 'Open new initiative as required by CEO behavior' },
  },
  {
    source: 'v2-local-actions.git_push',
    payload: { args: { repo: 'runcor-ai/startup-initiative-cycle190', path: 'README.md', content: '# startup-initiative-cycle190\n\nNew initiative launched by CEO at cycle 190.', commitMessage: 'init readme' }, result: '{"ok":true,"pushed":true,"path":"README.md","repo":"https://github.com/runcor-ai/startup-initiative-cycle190.git"}', reasoning: 'Commit initial README per orphan-initiative rule' },
  },
  {
    source: 'v2-local-actions.git_push',
    payload: { args: { repo: 'runcor-ai/startup-initiative-cycle434', path: 'data_processor.py', content: '"""Data processor module."""\n\ndef process(data):\n    return data' }, result: 'ERROR: {"ok":false,"error":"path/commitMessage required"}', reasoning: 'Push code to advance the initiative' },
  },
  {
    source: 'v2-local-actions.inbox_read',
    payload: { args: { limit: 10 }, result: '{"ok":true,"count":3,"messages":[{"subject":"Welcome to the team","from":"alex@example.com","date":"2026-05-09","body":"Glad to have you on board."},{"subject":"Q3 planning","from":"founder@runcor.ai","date":"2026-05-08","body":"We need to align on Q3 OKRs by Friday."},{"subject":"Newsletter","from":"news@techcrunch.com","date":"2026-05-09","body":"Top 5 AI startups this week"}]}', reasoning: 'First cycle of the day: triage inbox' },
  },
  {
    source: 'v2-local-actions.inbox_read',
    payload: { args: { limit: 10 }, result: 'ERROR: {"ok":false,"error":"Command failed"}', reasoning: 'Triage inbox' },
  },
  {
    source: 'v2-local-actions.web_search',
    payload: { args: { query: 'AI agent benchmarks 2026' }, result: '{"results":[{"title":"GAIA: A Benchmark for General AI Assistants","snippet":"GAIA evaluates real-world AI agent capabilities","url":"https://arxiv.org/abs/2311.12983"},{"title":"AgentBench v2","snippet":"Comprehensive benchmark across 8 environments","url":"https://github.com/THUDM/AgentBench"}]}', reasoning: 'Research the competitive landscape for our AI agent product' },
  },
  {
    source: 'v2-local-actions.firecrawl_scrape',
    payload: { args: { url: 'https://stripe.com/atlas' }, result: '{"ok":true,"title":"Stripe Atlas","markdown":"Start your company with Stripe Atlas. Incorporate as a Delaware C-corp, open a US bank account, get tax-ready. $500 one-time fee."}', reasoning: 'Research incorporation options for the company' },
  },
  {
    source: 'v2-local-actions.fs_write',
    payload: { args: { path: 'scratchpad/decision-log.md', content: '## Day 0, Cycle 240\n\nDecided to incorporate via Stripe Atlas based on research from cycle 239. Will fund the $500 fee from initial founder capital.' }, result: '{"ok":true,"path":"scratchpad/decision-log.md","bytesWritten":172}', reasoning: 'Journal incorporation decision' },
  },
  {
    source: 'v2-local-actions.email_send',
    payload: { args: { to: 'alex@example.com', subject: 'Welcome — quick intro call?', body: 'Hi Alex, glad to have you on the team. Want to grab 30 min this week to align on what you are picking up first? — CEO' }, result: '{"ok":true,"messageId":"<abc123@runcor.ai>","to":"alex@example.com"}', reasoning: 'Reply to onboarding-related inbox message' },
  },
  {
    source: 'v2-local-actions.publish_post',
    payload: { args: { title: 'Why we incorporated this week', body: 'We chose Stripe Atlas. Here is the reasoning...' }, result: '{"ok":true,"url":"https://blog.runcor.ai/why-we-incorporated-this-week","slug":"why-we-incorporated-this-week"}', reasoning: 'Quarterly thought-leadership post per CEO seed checklist' },
  },
  {
    source: 'v2-local-actions.web_search',
    payload: { args: { query: 'pre-seed valuation benchmarks 2026' }, result: '{"results":[{"title":"Pre-seed median valuation $5M (2026)","snippet":"Pre-seed rounds in 2026 are landing at $4-7M post-money median","url":"https://carta.com/insights/pre-seed-2026"}]}', reasoning: 'Research fundraising benchmarks before founder discussion' },
  },
  {
    source: 'v2-local-actions.fs_read',
    payload: { args: { path: 'scratchpad/decision-log.md' }, result: '{"ok":true,"content":"## Day 0, Cycle 240\\n\\nDecided to incorporate via Stripe Atlas..."}', reasoning: 'Review prior decisions before journaling new one' },
  },
  {
    source: 'v2-local-actions.github_create_repo',
    payload: { args: { name: 'pricing-experiments' }, result: '{"ok":true,"created":true,"repo":"runcor-ai/pricing-experiments","url":"https://github.com/runcor-ai/pricing-experiments"}', reasoning: 'Open initiative for pricing-strategy work' },
  },
  {
    source: 'v2-local-actions.git_push',
    payload: { args: { repo: 'runcor-ai/pricing-experiments', path: 'README.md', content: '# Pricing experiments\n\nTrack hypotheses + experiment results for runcor pricing.', commitMessage: 'init: pricing experiments tracker' }, result: '{"ok":true,"pushed":true,"path":"README.md"}', reasoning: 'Initial README for new initiative' },
  },
  {
    source: 'v2-local-actions.email_send',
    payload: { args: { to: 'founder@runcor.ai', subject: 'Q3 OKR proposal', body: 'Per your Friday note: proposing Q3 OKRs are (1) ship runner-v2 to first paid pilot, (2) close $500K pre-seed at $5M post.' }, result: '{"ok":true,"messageId":"<def456@runcor.ai>"}', reasoning: 'Reply to founder Q3 planning request from inbox' },
  },
  {
    source: 'v2-local-actions.firecrawl_scrape',
    payload: { args: { url: 'https://carta.com/insights/pre-seed-2026' }, result: '{"ok":true,"title":"Pre-seed 2026","markdown":"Median pre-seed: $5M post. Top quartile: $8M. SAFE notes still dominate (78% of rounds)."}', reasoning: 'Pull source data for fundraising memo' },
  },
  {
    source: 'v2-local-actions.fs_write',
    payload: { args: { path: 'scratchpad/decision-log.md', content: '## Day 0, Cycle 280\n\nDecided to target $500K pre-seed at $5M post (median per Carta data, cycle 277 research).' }, result: '{"ok":true,"path":"scratchpad/decision-log.md","bytesWritten":134}', reasoning: 'Journal fundraising target decision' },
  },
  {
    source: 'v2-local-actions.web_search',
    payload: { args: { query: 'best CRM for early-stage startups 2026' }, result: '{"results":[{"title":"Attio vs HubSpot for seed-stage","snippet":"Attio: $0/user free tier; HubSpot CRM: $0 free; Folk: $20/seat/month"}]}', reasoning: 'Research CRM tooling — agent will use this for sales pipeline' },
  },
  {
    source: 'v2-local-actions.github_create_repo',
    payload: { args: { name: 'sales-pipeline' }, result: '{"ok":true,"created":true,"repo":"runcor-ai/sales-pipeline","url":"https://github.com/runcor-ai/sales-pipeline"}', reasoning: 'Initiative: track sales pipeline before adopting full CRM' },
  },
  {
    source: 'v2-local-actions.fs_write',
    payload: { args: { path: 'scratchpad/decision-log.md', content: '## Day 0, Cycle 320\n\nDecided to use Attio (free) for CRM until we hit 50 leads, then evaluate paid Folk vs HubSpot.' }, result: '{"ok":true,"bytesWritten":118}', reasoning: 'Journal CRM-tooling decision' },
  },
];

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('FAIL — OPENROUTER_API_KEY not set');
    process.exit(2);
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error('FAIL — OPENAI_API_KEY not set (needed for embeddings)');
    process.exit(2);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'probe-data-'));
  const dbPath = join(tmp, 'data.db');
  console.log(`[probe-01] db=${dbPath} model=${COMPONENT_MODEL}`);
  console.log(`[probe-01] inputs: ${SAMPLE_INGESTS.length} realistic V2 cycle results\n`);

  const model = makeOpenRouterModel(apiKey);
  const cube = new DataCube({ dbPath, openaiApiKey: openaiKey, model });

  let priorEntityCount = 0;
  let totalErrors = 0;

  for (let i = 0; i < SAMPLE_INGESTS.length; i++) {
    const sample = SAMPLE_INGESTS[i]!;
    const cycle = 100 + i;
    const t0 = Date.now();
    try {
      await cube.ingest({ cycle, source: sample.source, payload: sample.payload });
      const stats = cube.getStats();
      const delta = stats.entities - priorEntityCount;
      priorEntityCount = stats.entities;
      const tool = sample.source.replace('v2-local-actions.', '');
      const errOk = sample.payload.result.startsWith('ERROR') ? '(err)' : '(ok) ';
      console.log(`  ${String(i + 1).padStart(2)}. cycle=${cycle} ${tool.padEnd(22)} ${errOk}  Δentities=${delta >= 0 ? '+' : ''}${delta}  total=${stats.entities}  edges=${stats.edges}  ${Date.now() - t0}ms`);
    } catch (err) {
      totalErrors++;
      console.log(`  ${String(i + 1).padStart(2)}. cycle=${cycle} ${sample.source.replace('v2-local-actions.', '').padEnd(22)} INGEST_ERROR: ${err instanceof Error ? err.message.slice(0, 100) : String(err)}`);
    }
  }

  const finalStats = cube.getStats();
  console.log('\n=== RESULT ===');
  console.log(`Final stats: ${finalStats.entities} entities, ${finalStats.edges} edges, ${finalStats.openConflicts} open conflicts`);
  console.log(`Ingest errors: ${totalErrors}/${SAMPLE_INGESTS.length}`);
  console.log(`Goal-propose readiness gate (≥10): ${finalStats.entities >= 10 ? 'OPEN' : 'CLOSED'}`);
  console.log(`Identity-reflect readiness gate (≥15): ${finalStats.entities >= 15 ? 'OPEN' : 'CLOSED'}`);

  // Sample entities for inspection
  if (finalStats.entities > 0) {
    console.log('\n=== Sample entities (first 5) ===');
    const allNodes = (cube as unknown as { db: { getAllNodes: () => Array<{ id: string; entity_type: string; name?: string; structured?: unknown }> } }).db.getAllNodes();
    for (const n of allNodes.slice(0, 5)) {
      console.log(`  - [${n.entity_type}] ${n.name || n.id} → ${JSON.stringify(n.structured).slice(0, 150)}`);
    }
  }

  // Pass/fail
  const PASS = finalStats.entities >= 10;
  console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${PASS ? 'cube populated as readiness gates expect' : 'cube did NOT populate to gate threshold'}`);

  // Cleanup
  rmSync(tmp, { recursive: true, force: true });
  process.exit(PASS ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
