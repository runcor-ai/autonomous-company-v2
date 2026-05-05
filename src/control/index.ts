// Control runner — fixed-cadence loop until budget or maxCycles hit.

import { Store } from '../shared/db.js';
import { OpenRouterClient, BudgetExceededError } from '../shared/openrouter.js';
import { runControlCycle } from './cycle.js';
import type { ActionDispatcher } from '../agent/dispatcher.js';

export interface ControlRunnerConfig {
  /** Pre-built store. If omitted, dbPath is used. */
  store?: Store;
  dbPath?: string;
  apiKey: string;
  budgetCapUsd: number;
  maxCycles: number;
  intervalSeconds: number;
  promptSeed: string;
  /** Override sleep impl (for tests). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Override OpenRouter client (for tests). MUST share the same store. */
  client?: OpenRouterClient;
  /** Optional callback fired on each cycle / action — used for live SSE. */
  onEvent?: (event: { type: 'cycle' | 'action'; payload: unknown }) => void;
  /** Action dispatcher — same rails as V2. Without it, control reasons into a void. */
  dispatcher?: ActionDispatcher;
}

export interface ControlRunResult {
  cyclesRun: number;
  reason: 'maxCycles' | 'budgetExhausted' | 'terminated' | 'error';
  totalSpentUsd: number;
}

const defaultSleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

export async function runControl(config: ControlRunnerConfig): Promise<ControlRunResult> {
  const ownStore = config.store === undefined;
  const store = config.store ?? new Store(config.dbPath ?? './control.db');
  const openrouter = config.client ?? new OpenRouterClient({
    apiKey: config.apiKey,
    budgetCapUsd: config.budgetCapUsd,
    kind: 'control',
    store,
  });
  const sleep = config.sleepImpl ?? defaultSleep;

  const startCycle = store.lastCycleNumber('control') + 1;
  let cyclesRun = 0;
  let reason: ControlRunResult['reason'] = 'maxCycles';

  for (let n = startCycle; n < config.maxCycles; n++) {
    try {
      const result = await runControlCycle({
        store, openrouter,
        prompt: config.promptSeed,
        cycleNumber: n,
        ...(config.dispatcher !== undefined ? { dispatcher: config.dispatcher } : {}),
      });
      cyclesRun++;
      if (config.onEvent) {
        config.onEvent({ type: 'cycle', payload: {
          cycleNumber: n, status: 'complete', costUsd: result.costUsd,
          ...(result.parsedAction ? { action: result.parsedAction.action } : {}),
        }});
        if (result.parsedAction) {
          config.onEvent({ type: 'action', payload: {
            cycleNumber: n, action: result.parsedAction.action,
            ...(result.parsedAction.thought ? { thought: result.parsedAction.thought } : {}),
          }});
        }
      }
      if (result.parsedAction?.action === 'terminate') {
        reason = 'terminated';
        break;
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) { reason = 'budgetExhausted'; break; }
      // Any other error — log and CONTINUE. One bad cycle shouldn't kill the runner.
      const msg = (err as Error).message ?? String(err);
      console.warn(`[runcor control] cycle ${n} failed: ${msg.slice(0, 200)} — continuing`);
      config.onEvent?.({ type: 'cycle', payload: {
        cycleNumber: n, status: 'failed', error: msg.slice(0, 500),
      }});
    }
    if (n < config.maxCycles - 1) await sleep(config.intervalSeconds * 1000);
  }

  const totalSpentUsd = store.totalSpentUsd('control');
  if (ownStore) store.close();
  return { cyclesRun, reason, totalSpentUsd };
}
