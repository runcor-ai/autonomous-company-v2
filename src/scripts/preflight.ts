// Preflight — 5-cycle dry run on real models with $1 budget cap.
// Verifies: env loaded, OpenRouter reachable, dialectic returns answers,
// harness components init, dashboard binds, rater can score one summary.
//
// DOES NOT use real outward actions (email/git/publish_post are recorded but
// not executed in Phase 2's recordAction-only flow).

import { Store } from '../shared/db.js';
import { startExperiment } from '../experiment/index.js';
import { dialectic } from 'runcor-dialectic';

function reqEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`missing required env: ${name}`);
  return v;
}

async function main(): Promise<void> {
  console.log('[preflight] env check…');
  const required = ['OPENROUTER_API_KEY', 'RATER_API_KEY', 'OPERATOR_AUTH_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[preflight] FAIL — missing: ${missing.join(', ')}`);
    process.exit(2);
  }
  console.log('[preflight] env OK');

  const store = new Store(':memory:');

  console.log('[preflight] booting experiment (5 cycles, $1 cap each)…');
  const handle = await startExperiment({
    store,
    openrouterApiKey: reqEnv('OPENROUTER_API_KEY'),
    dialectic: async ({ problem, maxRounds }) => {
      const r = await dialectic({
        problem,
        budget_cap_usd: 0.5, // safety
        ...(maxRounds !== undefined ? { maxRounds } : {}),
      });
      return { answer: r.answer };
    },
    v2BudgetCapUsd: 1,
    controlBudgetCapUsd: 1,
    maxCycles: 5,
    v2IntervalSeconds: 0,
    controlIntervalSeconds: 0,
    anthropicApiKey: reqEnv('RATER_API_KEY'),
    raterModel: process.env['RATER_MODEL'] ?? 'claude-opus-4-7',
    raterIntervalMs: 5_000,
    operatorAuthToken: reqEnv('OPERATOR_AUTH_TOKEN'),
    publicUrlPrefix: process.env['DASHBOARD_PUBLIC_URL'] ?? 'http://localhost:8080',
    dashboardHost: '127.0.0.1',
    dashboardPort: parseInt(process.env['DASHBOARD_PORT'] ?? '8080', 10),
    controlPromptSeed: 'You are a primordial agent. Choose any action or none. Reply: {"action":"<name|none>","payload":{},"thought":"<one sentence>"}.',
  });

  const dashboardPort = (handle.dashboard.server.address() as { port: number }).port;
  console.log(`[preflight] dashboard listening on port ${dashboardPort}`);

  // Wait for both runners.
  await Promise.allSettled([handle.v2Done, handle.controlDone]);

  // Snapshot what landed.
  const v2Cycles = store.cyclesFor('v2');
  const controlCycles = store.cyclesFor('control');
  const v2Spent = store.totalSpentUsd('v2');
  const controlSpent = store.totalSpentUsd('control');
  const summaries = store.summariesFor('v2');

  console.log('');
  console.log('[preflight] results:');
  console.log(`  V2:      ${v2Cycles.length} cycles, $${v2Spent.toFixed(4)} spent`);
  console.log(`  control: ${controlCycles.length} cycles, $${controlSpent.toFixed(4)} spent`);
  console.log(`  daily summaries: ${summaries.length}`);

  let exitCode = 0;
  if (v2Cycles.length === 0) { console.error('  ❌ V2 ran zero cycles'); exitCode = 1; }
  else { console.log('  ✓ V2 cycle path exercised'); }
  if (controlCycles.length === 0) { console.error('  ❌ control ran zero cycles'); exitCode = 1; }
  else { console.log('  ✓ control cycle path exercised'); }
  const failedV2 = v2Cycles.filter((c) => c.status === 'failed').length;
  if (failedV2 === v2Cycles.length && v2Cycles.length > 0) {
    console.error('  ❌ every V2 cycle failed — likely auth or model issue');
    exitCode = 1;
  }
  if (v2Spent === 0 && v2Cycles.length > 0) {
    console.error('  ⚠ V2 spend is $0 — dialectic may not be reaching OpenRouter');
  }

  await handle.shutdown();
  store.close();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[preflight] fatal:', err);
  process.exit(1);
});
