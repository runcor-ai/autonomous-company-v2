// V2 agent runner — Phase 3: real harness wiring.
// Phase 2's fixed-cadence stub remains; Phase 5 integrates runcor-temporal adaptive next-wake.

import { Store } from '../shared/db.js';
import { OpenRouterClient, BudgetExceededError } from '../shared/openrouter.js';
import { bootHarness, closeHarness, type DialecticLike } from './boot.js';
import { runAgentCycle } from './cycle.js';
import { isDayBoundary, reflectAndPublish, type DayBoundaryConfig } from './daily.js';
import type { ActionDispatcher } from './dispatcher.js';

export interface AgentRunnerConfig {
  store?: Store;
  dbPath?: string;
  apiKey: string;
  budgetCapUsd: number;
  maxCycles: number;
  intervalSeconds: number;
  /** Caller-provided dialectic. Production = runcor-dialectic; tests = mock. */
  dialectic: DialecticLike;
  /** Optional per-component DB paths. Default: in-memory. */
  harnessDbPaths?: { identity?: string; goals?: string; temporal?: string; meta?: string; coherence?: string };
  /** Estimated USD burn per cycle, fed to drives. Default 0.005. */
  burnPerCycleUsd?: number;
  /** Day-boundary detection config. */
  dayBoundary?: DayBoundaryConfig;
  /** Public URL prefix for published-summary links. Default: localhost. */
  publicUrlPrefix?: string;
  /** Optional pause flag the runner consults between cycles (operator pause). */
  isPaused?: () => boolean;
  /** Optional callback fired when a daily summary is published. */
  onDailySummary?: (summary: { dayNumber: number; summaryId: number; text: string; publicUrl: string }) => void;
  /** Optional callback fired on each cycle / decision / action — used for live SSE. */
  onEvent?: (event: { type: 'cycle' | 'decision' | 'action'; payload: unknown }) => void;
  /** Action dispatcher — when omitted actions are recorded but not executed. */
  dispatcher?: ActionDispatcher;
  sleepImpl?: (ms: number) => Promise<void>;
  client?: OpenRouterClient;
}

export interface AgentRunResult {
  cyclesRun: number;
  reason: 'maxCycles' | 'budgetExhausted' | 'terminated' | 'error';
  totalSpentUsd: number;
}

const defaultSleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

export async function runAgent(config: AgentRunnerConfig): Promise<AgentRunResult> {
  const ownStore = config.store === undefined;
  const store = config.store ?? new Store(config.dbPath ?? './agent.db');
  const openrouter = config.client ?? new OpenRouterClient({
    apiKey: config.apiKey,
    budgetCapUsd: config.budgetCapUsd,
    kind: 'v2',
    store,
  });
  const harness = bootHarness({
    dialectic: config.dialectic,
    ...(config.harnessDbPaths !== undefined ? { dbPaths: config.harnessDbPaths } : {}),
  });
  const sleep = config.sleepImpl ?? defaultSleep;
  const burnPerCycleUsd = config.burnPerCycleUsd ?? 0.005;

  const startCycle = store.lastCycleNumber('v2') + 1;
  let cyclesRun = 0;
  let reason: AgentRunResult['reason'] = 'maxCycles';

  const publicUrlPrefix = config.publicUrlPrefix ?? 'http://localhost';
  try {
    for (let n = startCycle; n < config.maxCycles; n++) {
      // Honor operator pause between cycles (Constitution Principle IV — operator
      // can pause but cannot kill).
      while (config.isPaused?.()) await sleep(500);

      try {
        const result = await runAgentCycle({
          store, openrouter, harness,
          cycleNumber: n,
          budgetRemainingUsd: Math.max(0, config.budgetCapUsd - store.totalSpentUsd('v2')),
          burnPerCycleUsd,
          ...(config.onEvent !== undefined ? { onEvent: config.onEvent } : {}),
          ...(config.dispatcher !== undefined ? { dispatcher: config.dispatcher } : {}),
        });
        cyclesRun++;
        if (result.parsedAction?.action === 'terminate') { reason = 'terminated'; break; }
      } catch (err) {
        if (err instanceof BudgetExceededError) { reason = 'budgetExhausted'; break; }
        reason = 'error';
        throw err;
      }

      // Day-end detection: after the cycle completes, check whether we crossed
      // a day boundary. If so, run reflect-on-day then publish.
      if (isDayBoundary(n, store, config.dayBoundary)) {
        try {
          const summary = await reflectAndPublish({
            store, harness, cycleEnd: n, publicUrlPrefix,
            ...(config.dayBoundary !== undefined ? { config: config.dayBoundary } : {}),
          });
          config.onDailySummary?.(summary);
        } catch { /* swallow — next day's reflection will retry */ }
      }

      if (n < config.maxCycles - 1) await sleep(config.intervalSeconds * 1000);
    }
  } finally {
    closeHarness(harness);
  }

  const totalSpentUsd = store.totalSpentUsd('v2');
  if (ownStore) store.close();
  return { cyclesRun, reason, totalSpentUsd };
}
