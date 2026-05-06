// V2 preflight — sanity-checks env vars + sibling resolution before `npm start`.
//
// Exits non-zero with a precise error if anything is missing. Run after `npm run build`:
//   node dist/scripts/preflight.js
//
// Checks:
//   1. All 14 canonical sibling packages resolve (node_modules/<name>/package.json exists).
//   2. Required env vars present: OPENROUTER_API_KEY, OPERATOR_AUTH_TOKEN.
//   3. Optional env vars (Firecrawl, email, git) are reported as configured/unconfigured.
//   4. control-config.json parses + hashes (FR-102 freeze surface).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CANONICAL_COMPONENTS } from '../boot/components.js';
import { loadControlConfig } from '../control/config.js';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

async function checkComponent(name: string): Promise<CheckResult> {
  try {
    const pjson = path.resolve('node_modules', name, 'package.json');
    const meta = JSON.parse(await readFile(pjson, 'utf8')) as { version?: string };
    return { name: `component:${name}`, status: 'pass', detail: `v${meta.version ?? '?'}` };
  } catch (err) {
    return { name: `component:${name}`, status: 'fail', detail: err instanceof Error ? err.message : 'unresolved' };
  }
}

function checkRequiredEnv(name: string): CheckResult {
  const v = process.env[name];
  if (typeof v === 'string' && v.length > 0) {
    return { name: `env:${name}`, status: 'pass', detail: 'set' };
  }
  return { name: `env:${name}`, status: 'fail', detail: 'missing' };
}

function checkOptionalEnv(name: string): CheckResult {
  const v = process.env[name];
  if (typeof v === 'string' && v.length > 0) {
    return { name: `env:${name}`, status: 'pass', detail: 'set' };
  }
  return { name: `env:${name}`, status: 'warn', detail: 'not set (optional)' };
}

async function checkControlConfig(): Promise<CheckResult> {
  try {
    const loaded = await loadControlConfig();
    return { name: 'control-config.json', status: 'pass', detail: `hash=${loaded.hash.slice(0, 12)}…` };
  } catch (err) {
    return { name: 'control-config.json', status: 'fail', detail: err instanceof Error ? err.message : 'parse error' };
  }
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  for (const name of CANONICAL_COMPONENTS) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await checkComponent(name));
  }
  results.push(checkRequiredEnv('OPENROUTER_API_KEY'));
  results.push(checkRequiredEnv('OPERATOR_AUTH_TOKEN'));
  results.push(checkOptionalEnv('FIRECRAWL_API_KEY'));
  results.push(checkOptionalEnv('RUNNER_EMAIL_USER'));
  results.push(checkOptionalEnv('GIT_PUSH_REPO'));
  results.push(checkOptionalEnv('GIT_PUSH_TOKEN'));
  results.push(checkOptionalEnv('WEB_SEARCH_API_KEY'));
  results.push(await checkControlConfig());

  const fails = results.filter((r) => r.status === 'fail');
  const warns = results.filter((r) => r.status === 'warn');

  for (const r of results) {
    const symbol = r.status === 'pass' ? 'OK' : r.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${symbol}] ${r.name}: ${r.detail}`);
  }

  console.log('');
  console.log(`Pass: ${results.length - fails.length - warns.length}, Warn: ${warns.length}, Fail: ${fails.length}`);

  if (fails.length > 0) {
    console.error('\n[preflight] Boot will fail. Fix the above before running `npm start`.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[preflight] fatal:', err);
  process.exit(1);
});
