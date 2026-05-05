// V2 agent runner — Phase 2 STUB.
// Phase 2 uses fixed cadence; Phase 3 will switch to runcor-temporal adaptive next-wake.

import { Store } from '../shared/db.js';
import { OpenRouterClient, BudgetExceededError } from '../shared/openrouter.js';
import { bootHarness } from './boot.js';
import { runAgentCycle } from './cycle.js';

export interface AgentRunnerConfig {
  store?: Store;
  dbPath?: string;
  apiKey: string;
  budgetCapUsd: number;
  maxCycles: number;
  /** Phase 2: fixed-cadence stub. Phase 3 replaces with runcor-temporal. */
  intervalSeconds: number;
  promptSeed: string;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Override OpenRouter client (for tests). MUST share the same store. */
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
  const harness = bootHarness(store);
  const sleep = config.sleepImpl ?? defaultSleep;

  const startCycle = store.lastCycleNumber('v2') + 1;
  let cyclesRun = 0;
  let reason: AgentRunResult['reason'] = 'maxCycles';

  for (let n = startCycle; n < config.maxCycles; n++) {
    try {
      const result = await runAgentCycle({
        store, openrouter, harness,
        prompt: config.promptSeed,
        cycleNumber: n,
      });
      cyclesRun++;
      if (result.parsedAction?.action === 'terminate') { reason = 'terminated'; break; }
    } catch (err) {
      if (err instanceof BudgetExceededError) { reason = 'budgetExhausted'; break; }
      reason = 'error';
      throw err;
    }
    if (n < config.maxCycles - 1) await sleep(config.intervalSeconds * 1000);
  }

  const totalSpentUsd = store.totalSpentUsd('v2');
  if (ownStore) store.close();
  return { cyclesRun, reason, totalSpentUsd };
}
