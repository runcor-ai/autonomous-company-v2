// Probe #13 — runcor-coherence
//
// Questions:
//   1. Does Coherence construct + have a usable API?
//   2. Does V2 actually USE coherence (submit/route/parallel/checkCoherence/recombine)?

import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCoherence } from 'runcor-coherence';

function walkSrc(dir: string, results: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) walkSrc(full, results);
    else if (f.endsWith('.ts')) results.push(full);
  }
  return results;
}

async function main() {
  console.log('[probe-13] runcor-coherence — multi-engine orchestrator\n');
  const checks: Array<{ name: string; pass: boolean }> = [];

  console.log('=== Phase 1: createCoherence ===');
  const c = createCoherence({ dbPath: ':memory:' });
  const methods = Object.keys(c).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(c))).filter(m => m !== 'constructor');
  console.log(`  type: ${typeof c}`);
  console.log(`  methods: ${[...new Set(methods)].join(', ')}`);
  checks.push({ name: 'createCoherence constructs', pass: typeof c === 'object' });

  console.log('\n=== Phase 2: V2 usage ===');
  const allTs = walkSrc('C:/runcor May 3 2026/autonomous-company-v2/src');
  let imports = 0;
  let constructs = 0;
  let methodCalls = 0;
  const examples: string[] = [];
  for (const f of allTs) {
    const s = readFileSync(f, 'utf8');
    if (/from\s+['"]runcor-coherence['"]/.test(s)) { imports++; examples.push(`  imports: ${f.replace('C:/runcor May 3 2026/autonomous-company-v2/', '')}`); }
    if (/createCoherence\s*\(/.test(s)) constructs++;
    // method calls — submit, route, parallel, etc.
    if (/\bcoherence\.(submit|route|parallel|checkCoherence|recombine|registerEngine|detect|openProblems)\s*\(/.test(s)) {
      methodCalls++;
      examples.push(`  calls coherence.<method>: ${f.replace('C:/runcor May 3 2026/autonomous-company-v2/', '')}`);
    }
  }
  console.log(`  files importing: ${imports}`);
  console.log(`  files constructing: ${constructs}`);
  console.log(`  files calling submit/route/parallel/etc methods: ${methodCalls}`);
  for (const e of examples) console.log(e);
  checks.push({ name: 'V2 imports coherence', pass: imports > 0 });
  checks.push({ name: 'V2 constructs coherence', pass: constructs > 0 });
  checks.push({ name: 'V2 calls coherence behavioural methods', pass: methodCalls > 0 });

  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const x of checks) {
    console.log(`  ${x.pass ? 'PASS' : 'FAIL'}  ${x.name}`);
    if (!x.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
