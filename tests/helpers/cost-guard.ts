// INTEGRATION_TEST_BUDGET_USD enforcement (operator's standing instruction for V2-002).
// Test runner aborts if engine cost telemetry exceeds the cap — insurance against a bug
// spinning up runaway model calls. Real-service tests register their engine with this
// guard; stub-provider tests are no-ops because cost is zero.

import type { Runcor } from 'runcor';

const BUDGET_ENV = 'INTEGRATION_TEST_BUDGET_USD';
const DEFAULT_BUDGET_USD = 2.0;

export function readIntegrationBudgetUsd(): number {
  const v = process.env[BUDGET_ENV];
  if (typeof v !== 'string' || v.length === 0) return DEFAULT_BUDGET_USD;
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUDGET_USD;
}

export interface CostGuardHandle {
  /** Total cost observed since attach. */
  totalUsd(): number;
  /** Detach handlers (call from afterEach). */
  detach(): void;
  /** Throws if budget exceeded — call after each interesting model call. */
  assertWithinBudget(): void;
}

export function attachCostGuard(engine: Runcor, opts: { budgetUsd?: number } = {}): CostGuardHandle {
  const cap = opts.budgetUsd ?? readIntegrationBudgetUsd();
  let total = 0;
  const handler = (ev: { cost: number }): void => {
    if (typeof ev.cost === 'number') total += ev.cost;
    if (total > cap) {
      throw new Error(
        `[cost-guard] Integration test budget exceeded: $${total.toFixed(4)} > $${cap.toFixed(2)} (${BUDGET_ENV})`,
      );
    }
  };
  engine.on('cost:request', handler);
  return {
    totalUsd: () => total,
    detach: (): void => {
      engine.off('cost:request', handler as Parameters<typeof engine.off>[1]);
    },
    assertWithinBudget: (): void => {
      if (total > cap) {
        throw new Error(`[cost-guard] Budget exceeded: $${total.toFixed(4)} > $${cap.toFixed(2)}`);
      }
    },
  };
}
