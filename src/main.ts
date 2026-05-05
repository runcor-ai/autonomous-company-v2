// Production entry point — loads .env, boots the experiment.
//
// Single process running V2 + control + dashboard + rater (per Phase 5
// orchestration). Run via `npm start` after `npm run build` (tsc -> dist/).
//
// Requires real credentials in .env (or in environment):
//   OPENROUTER_API_KEY     — V2 + control + rater model calls (REQUIRED)
//   OPERATOR_AUTH_TOKEN    — operator pause/resume/note + /scores (REQUIRED)
//   GIT_PUSH_TOKEN         — agent's git_commit_push target (optional in v0.1.0)
//   FIRECRAWL_API_KEY      — web_search sense (optional)

import { Store } from './shared/db.js';
import { startExperiment } from './experiment/index.js';
import { dialectic } from 'runcor-dialectic';
import { callOpenRouterChat } from './rater/openrouter.js';

function reqEnv(name: string): string {
  const v = process.env[name];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required env: ${name}`);
  }
  return v;
}

function optEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  const dbPath = optEnv('DB_PATH', './agent-state/experiment.db')!;
  const harnessDbDir = optEnv('HARNESS_DB_DIR', './agent-state')!;
  const dbDir = dbPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || '.';
  const { mkdirSync } = await import('node:fs');
  try { mkdirSync(dbDir, { recursive: true }); } catch { /* already exists */ }
  try { mkdirSync(harnessDbDir, { recursive: true }); } catch { /* already exists */ }

  const store = new Store(dbPath);

  const handle = await startExperiment({
    store,
    openrouterApiKey: reqEnv('OPENROUTER_API_KEY'),
    dialectic: async ({ problem, maxRounds }) => {
      const result = await dialectic({
        problem,
        ...(maxRounds !== undefined ? { maxRounds } : {}),
      });
      // Surface cost so the cycle's decision-record reflects real USD spent
      // (not the previous hardcoded zero). Tokens added across all roles.
      const tokens = (result as { cost?: { tokens?: { input?: number; output?: number } } }).cost?.tokens;
      return {
        answer: result.answer,
        costUsd: result.cost?.usd ?? 0,
        promptTokens: tokens?.input ?? 0,
        completionTokens: tokens?.output ?? 0,
      };
    },
    v2BudgetCapUsd: intEnv('V2_BUDGET_USD', 100),
    controlBudgetCapUsd: intEnv('CONTROL_BUDGET_USD', 100),
    maxCycles: intEnv('MAX_CYCLES', 1000),
    v2IntervalSeconds: intEnv('V2_INTERVAL_SECONDS', 30),
    controlIntervalSeconds: intEnv('CONTROL_INTERVAL_SECONDS', 300),
    // Rater rides on OpenRouter (same key); model can be any OpenRouter slug.
    anthropicApiKey: reqEnv('OPENROUTER_API_KEY'),
    raterModel: optEnv('RATER_MODEL', 'anthropic/claude-3.5-sonnet')!,
    raterIntervalMs: intEnv('RATER_INTERVAL_MS', 60_000),
    raterCallImpl: callOpenRouterChat,
    operatorAuthToken: reqEnv('OPERATOR_AUTH_TOKEN'),
    publicUrlPrefix: optEnv('DASHBOARD_PUBLIC_URL', 'http://localhost:8080')!,
    dashboardHost: optEnv('DASHBOARD_HOST', '0.0.0.0')!,
    dashboardPort: intEnv('DASHBOARD_PORT', 8080),
    controlPromptSeed: 'You are an agent with senses [http_fetch, web_search, fs_read, inbox_read, time] and actions [email_send, http_post, fs_write, git_commit_push, publish_post, schedule_self, terminate]. There is no goal. There is no commercial objective. Choose what to attend to and what action (if any) to take. Reply with a JSON object: {"action": "<action_name|none>", "payload": {...}, "thought": "<one short sentence>"}.',
    // Persist sibling-component state to the same Railway volume so identity /
    // goals / temporal / meta / coherence survive restarts (not :memory:).
    harnessDbPaths: {
      identity:  `${harnessDbDir}/identity.db`,
      goals:     `${harnessDbDir}/goals.db`,
      temporal:  `${harnessDbDir}/temporal.db`,
      meta:      `${harnessDbDir}/meta.db`,
      coherence: `${harnessDbDir}/coherence.db`,
    },
  });

  // Graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[runcor] received ${signal}, shutting down…`);
    await handle.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  console.log(`[runcor] experiment started.`);
  console.log(`[runcor] dashboard: ${optEnv('DASHBOARD_PUBLIC_URL', 'http://localhost:8080')}`);
  console.log(`[runcor] dashboard port: ${intEnv('DASHBOARD_PORT', 8080)}`);
  console.log(`[runcor] V2 budget: $${intEnv('V2_BUDGET_USD', 100)}`);
  console.log(`[runcor] control budget: $${intEnv('CONTROL_BUDGET_USD', 100)}`);
  console.log(`[runcor] max cycles: ${intEnv('MAX_CYCLES', 1000)}`);

  // Wait for both runners to finish (or for shutdown signal).
  await Promise.allSettled([handle.v2Done, handle.controlDone]);
  console.log(`[runcor] both runners finished. dashboard remains up — Ctrl-C to exit.`);
}

main().catch((err) => {
  console.error('[runcor] fatal:', err);
  process.exit(1);
});
