// Engine telemetry forwarder (T059, research.md §R13).
//
// Subscribes to the runcor engine's EventEmitter events and forwards normalized payloads to
// V2's EventBus. The dashboard's transcript SSE stream consumes from EventBus, so wiring the
// engine's events through here is what makes execution-state changes / model costs / adapter
// tool calls / provider health flips visible to observers (FR-030).
//
// Subscriptions are additive — multiple subscribers to the same event don't clobber. We register
// V2's forwarders once at boot and never remove (the engine's lifecycle matches the process's).

import type { Runcor } from 'runcor';
import type { EventBus } from '../dashboard/event-bus.js';

export interface SubscribeEngineTelemetryArgs {
  engine: Runcor;
  bus: EventBus;
  agentRole: 'v2' | 'control';
}

/**
 * Subscribe to the engine's event surface and forward normalized payloads to the V2 EventBus.
 * Returns an unsubscribe function for tests / clean shutdown — production boot ignores it.
 */
export function subscribeEngineTelemetry(
  args: SubscribeEngineTelemetryArgs,
): () => void {
  const { engine, bus, agentRole } = args;
  const unsubs: Array<() => void> = [];

  const on = <K extends keyof Parameters<Runcor['on']>[0] extends never ? never : never>(
    _ev: K,
    _handler: (...a: never) => void,
  ): never => {
    // marker — see the typed wrappers below
    return undefined as never;
  };
  void on;

  // cost:request — model call cost, fired per provider call (intra-provider retries each fire one)
  const costRequestHandler = (ev: { costUsd?: number; tokens?: { input: number; output: number }; model?: string; provider?: string }): void => {
    bus.emit('cost_request', { agentRole, ...ev });
  };
  engine.on('cost:request', costRequestHandler);
  unsubs.push(() => engine.off('cost:request', costRequestHandler));

  const budgetWarningHandler = (ev: unknown): void => {
    bus.emit('cost_budget_warning', { agentRole, payload: ev });
  };
  engine.on('cost:budget_warning', budgetWarningHandler);
  unsubs.push(() => engine.off('cost:budget_warning', budgetWarningHandler));

  const budgetExceededHandler = (ev: unknown): void => {
    bus.emit('cost_budget_exceeded', { agentRole, payload: ev });
  };
  engine.on('cost:budget_exceeded', budgetExceededHandler);
  unsubs.push(() => engine.off('cost:budget_exceeded', budgetExceededHandler));

  // execution lifecycle
  const stateChangeHandler = (ev: { executionId: string; from: string; to: string; timestamp: Date }): void => {
    bus.emit('execution_state_change', { agentRole, ...ev, timestamp: ev.timestamp.getTime() });
  };
  engine.on('execution:state_change', stateChangeHandler);
  unsubs.push(() => engine.off('execution:state_change', stateChangeHandler));

  const completeHandler = (ev: { executionId: string; state: string; result?: unknown; error?: unknown }): void => {
    bus.emit('execution_complete', { agentRole, ...ev });
  };
  engine.on('execution:complete', completeHandler);
  unsubs.push(() => engine.off('execution:complete', completeHandler));

  // adapter
  const adapterToolCallHandler = (ev: { adapter: string; tool: string; durationMs: number; success: boolean }): void => {
    bus.emit('adapter_tool_call', { agentRole, ...ev });
  };
  engine.on('adapter:tool_call', adapterToolCallHandler);
  unsubs.push(() => engine.off('adapter:tool_call', adapterToolCallHandler));

  const adapterConnectedHandler = (ev: { name: string }): void => {
    bus.emit('adapter_connected', { agentRole, ...ev });
  };
  engine.on('adapter:connected', adapterConnectedHandler);
  unsubs.push(() => engine.off('adapter:connected', adapterConnectedHandler));

  const adapterDisconnectedHandler = (ev: { name: string; reason?: string }): void => {
    bus.emit('adapter_disconnected', { agentRole, ...ev });
  };
  engine.on('adapter:disconnected', adapterDisconnectedHandler);
  unsubs.push(() => engine.off('adapter:disconnected', adapterDisconnectedHandler));

  // provider health
  const providerHealthChangeHandler = (ev: { provider: string; from: string; to: string; timestamp: Date }): void => {
    bus.emit('provider_health_change', { agentRole, ...ev, timestamp: ev.timestamp.getTime() });
  };
  engine.on('provider:health_change', providerHealthChangeHandler);
  unsubs.push(() => engine.off('provider:health_change', providerHealthChangeHandler));

  return () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        // ignore
      }
    }
  };
}
