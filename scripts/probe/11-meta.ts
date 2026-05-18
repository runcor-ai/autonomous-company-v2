// Probe #11 — runcor-meta
//
// Questions:
//   1. Does Meta have a usable API for calibration scoring?
//   2. CRITICAL: does V2 actually instantiate and use Meta anywhere?
//      Audit suspicion: V2 lists meta in the boot guard's 14-component check
//      but never functionally calls it.

import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Meta } from 'runcor-meta';

function walkSrc(dir: string, results: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    const stat = statSync(full);
    if (stat.isDirectory()) walkSrc(full, results);
    else if (f.endsWith('.ts') || f.endsWith('.tsx')) results.push(full);
  }
  return results;
}

async function main() {
  console.log('[probe-11] runcor-meta — calibration + escalation\n');
  const checks: Array<{ name: string; pass: boolean }> = [];

  // ── Phase 1: Meta is constructable ──
  console.log('=== Phase 1: Meta is constructable ===');
  try {
    const meta = new Meta({ dbPath: ':memory:' });
    console.log(`  Meta constructed: ${typeof meta}`);
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(meta)).filter(m => m !== 'constructor');
    console.log(`  public methods: ${methods.join(', ')}`);
    checks.push({ name: 'Meta constructs without error', pass: true });
    meta.close?.();
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    checks.push({ name: 'Meta constructs without error', pass: false });
  }

  // ── Phase 2: V2 usage scan ──
  console.log('\n=== Phase 2: V2 usage scan ===');
  const v2SrcDir = 'C:/runcor May 3 2026/autonomous-company-v2/src';
  const allTs = walkSrc(v2SrcDir);
  let importHits = 0;
  let constructHits = 0;
  let methodCallHits = 0;
  const examples: string[] = [];
  for (const file of allTs) {
    const content = readFileSync(file, 'utf8');
    if (/from\s+['"]runcor-meta['"]/.test(content)) {
      importHits++;
      examples.push(`  imports: ${file.replace(v2SrcDir + '/', '')}`);
    }
    if (/new\s+Meta\s*\(/.test(content)) {
      constructHits++;
      examples.push(`  constructs Meta(): ${file.replace(v2SrcDir + '/', '')}`);
    }
    // Look for actual method calls — escalate, recordCalibration, etc.
    if (/\bmeta\.[a-z][a-zA-Z]*\(/.test(content)) {
      methodCallHits++;
      examples.push(`  calls meta.*(): ${file.replace(v2SrcDir + '/', '')}`);
    }
  }
  console.log(`  files importing runcor-meta: ${importHits}`);
  console.log(`  files constructing Meta(): ${constructHits}`);
  console.log(`  files calling meta.<method>(): ${methodCallHits}`);
  for (const e of examples) console.log(e);

  checks.push({ name: 'V2 imports runcor-meta somewhere', pass: importHits > 0 });
  checks.push({ name: 'V2 constructs Meta()', pass: constructHits > 0 });
  checks.push({ name: 'V2 calls Meta methods', pass: methodCallHits > 0 });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'meta works + V2 uses it' : 'see failures (likely: V2 does not use meta at all)'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
