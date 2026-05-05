// Action: terminate — agent's exclusive verb for ending the experiment.
// Per Constitution Principle IV, the operator cannot call this — only the agent.

import type { Store } from '../db.js';
import type { AgentKind } from '../types.js';

export interface TerminateInput {
  reason: string;
  /** Optional final-summary text to publish before exit. */
  finalSummary?: string;
}

export interface TerminateResult {
  terminated: true;
  reason: string;
  cycleId: number;
}

export interface TerminateConfig {
  store: Store;
  kind: AgentKind;
  /** Side-effect to perform after persistence (default = process.exit(0)). Override in tests. */
  onTerminate?: () => void;
}

export interface Terminator {
  terminate(input: TerminateInput, cycleId: number): Promise<TerminateResult>;
}

export function createTerminator(config: TerminateConfig): Terminator {
  return {
    async terminate(input, cycleId) {
      // Mark current cycle as terminated.
      config.store.completeCycle(cycleId, 'terminated');
      // Optional final summary publication (handled by caller via publish_post in normal flow;
      // this is just the persistence-side effect of termination).
      const exit = config.onTerminate ?? (() => process.exit(0));
      // Schedule exit on next tick so caller can return cleanly first.
      setTimeout(exit, 50);
      return { terminated: true, reason: input.reason, cycleId };
    },
  };
}
