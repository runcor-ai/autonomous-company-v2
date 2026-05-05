// Experiment orchestrator — boots V2 agent + naive control + dashboard + rater.
// All four run concurrently; transcript events broadcast over the dashboard's bus.

import { Store } from '../shared/db.js';
import { OpenRouterClient } from '../shared/openrouter.js';
import { runAgent, type AgentRunnerConfig } from '../agent/index.js';
import { runControl, type ControlRunnerConfig } from '../control/index.js';
import { bootHarness, closeHarness, type AgentHarness, type DialecticLike } from '../agent/boot.js';
import { createDashboardServer, type DashboardServer } from '../dashboard/server.js';
import type { DashboardContext } from '../dashboard/types.js';
import { startRaterLoop, type RaterConfig } from '../rater/index.js';
import type { callAnthropic } from '../rater/anthropic.js';

export interface ExperimentConfig {
  /** Single shared SQLite store for V2 + control + summaries + scores. */
  store: Store;

  /** OpenRouter API key for V2 + control model calls. */
  openrouterApiKey: string;
  /** Caller-provided dialectic for V2 (production = runcor-dialectic). */
  dialectic: DialecticLike;

  /** Independent budgets per kind. Default $100 V2 + $100 control = $200 total. */
  v2BudgetCapUsd?: number;
  controlBudgetCapUsd?: number;
  /** Default 1000 cycles. */
  maxCycles?: number;
  /** Cycle gap. */
  v2IntervalSeconds?: number;
  controlIntervalSeconds?: number;

  /** Anthropic key + model for the external rater. */
  anthropicApiKey: string;
  raterModel?: string;
  /** Rater poll interval. Default 60s. */
  raterIntervalMs?: number;
  /** Override rater HTTP impl (tests inject mock; production = real Anthropic API). */
  raterCallImpl?: typeof callAnthropic;
  /** Override OpenRouter fetch impl (tests inject mock). Used for both V2 + control clients. */
  openrouterFetchImpl?: typeof fetch;

  /** Dashboard auth + URL. */
  operatorAuthToken: string;
  publicUrlPrefix: string;
  dashboardHost?: string;
  dashboardPort?: number;

  /** Naive-control prompt seed (frozen at experiment start). */
  controlPromptSeed: string;
}

export interface ExperimentHandle {
  dashboard: DashboardServer;
  v2Done: Promise<void>;
  controlDone: Promise<void>;
  stopRater: () => void;
  shutdown: () => Promise<void>;
}

export async function startExperiment(config: ExperimentConfig): Promise<ExperimentHandle> {
  const store = config.store;
  const v2Cap = config.v2BudgetCapUsd ?? 100;
  const controlCap = config.controlBudgetCapUsd ?? 100;
  const maxCycles = config.maxCycles ?? 1000;

  // Boot the V2 harness up-front so the dashboard can introspect it.
  const v2Harness = bootHarness({ dialectic: config.dialectic });

  // V2 client + control client share the same Store but track different `kind`.
  const v2Client = new OpenRouterClient({
    apiKey: config.openrouterApiKey, budgetCapUsd: v2Cap, kind: 'v2', store,
    ...(config.openrouterFetchImpl !== undefined ? { fetchImpl: config.openrouterFetchImpl } : {}),
  });
  const controlClient = new OpenRouterClient({
    apiKey: config.openrouterApiKey, budgetCapUsd: controlCap, kind: 'control', store,
    ...(config.openrouterFetchImpl !== undefined ? { fetchImpl: config.openrouterFetchImpl } : {}),
  });

  // Dashboard context — V2 has the in-process harness; control runs without one
  // (faithful to "control = same rails minus harness").
  const dashboardCtx: DashboardContext = {
    v2: {
      store, harness: v2Harness,
      budget: { spentUsd: () => store.totalSpentUsd('v2'), capUsd: v2Cap },
    },
    control: {
      store,
      budget: { spentUsd: () => store.totalSpentUsd('control'), capUsd: controlCap },
    },
    operatorAuthToken: config.operatorAuthToken,
    publicUrlPrefix: config.publicUrlPrefix,
  };
  const dashboard = createDashboardServer(dashboardCtx);
  await dashboard.listen(config.dashboardPort ?? 8080, config.dashboardHost ?? '0.0.0.0');

  // Rater — periodic poll for unscored summaries.
  const raterCfg: RaterConfig & { intervalMs: number } = {
    apiKey: config.anthropicApiKey,
    model: config.raterModel ?? 'claude-opus-4-7',
    store,
    intervalMs: config.raterIntervalMs ?? 60_000,
    ...(config.raterCallImpl !== undefined ? { callImpl: config.raterCallImpl } : {}),
  };
  const stopRater = startRaterLoop(raterCfg);

  // V2 runner.
  const v2Cfg: AgentRunnerConfig = {
    store, apiKey: config.openrouterApiKey, budgetCapUsd: v2Cap, maxCycles,
    intervalSeconds: config.v2IntervalSeconds ?? 30,
    dialectic: config.dialectic,
    publicUrlPrefix: config.publicUrlPrefix,
    isPaused: () => dashboard.pauseHandle.isPaused(),
    onDailySummary: (s) => dashboard.bus.broadcast({
      kind: 'v2', type: 'summary', payload: s, ts: new Date().toISOString(),
    }),
    client: v2Client,
  };
  const v2Done: Promise<void> = (async () => {
    try {
      await runAgent(v2Cfg);
    } finally {
      closeHarness(v2Harness);
    }
  })();

  // Control runner — frozen 5-min cadence, no harness.
  const controlCfg: ControlRunnerConfig = {
    store, apiKey: config.openrouterApiKey, budgetCapUsd: controlCap, maxCycles,
    intervalSeconds: config.controlIntervalSeconds ?? 300,
    promptSeed: config.controlPromptSeed,
    client: controlClient,
  };
  const controlDone: Promise<void> = (async () => { await runControl(controlCfg); })();

  return {
    dashboard,
    v2Done,
    controlDone,
    stopRater,
    async shutdown() {
      stopRater();
      await dashboard.close();
    },
  };
}

/** Helper: V2 harness pointer for tests / dashboard introspection. */
export function newV2Harness(dialectic: DialecticLike): AgentHarness {
  return bootHarness({ dialectic });
}
