// V2 EventBus (T082) — single in-process event channel for the dashboard.
//
// Receives:
//   - Engine telemetry forwards (src/engine/telemetry.ts) — cost, executions, adapters, providers
//   - Substrate events (`prompt_assembled`, `discernment`, `discernment_flagged`)
//   - V2 cycle records (CycleRecord rows, see data-model.md)
//   - Burst-warning events (FR-019f) computed from rolling window of `discernment_flagged`
//
// Consumed by:
//   - SSE route at /transcript (streams events to the browser as Server-Sent Events)
//   - In-process subscribers (e.g., flag-burst detector, harness monitor)
//
// Event payloads are intentionally loosely typed: the bus is a hub, not a contract enforcer.
// Routes that rely on specific payload shapes type-cast at consumption time.

import { EventEmitter } from 'node:events';

export type EventBusPayload = Record<string, unknown>;

export class EventBus extends EventEmitter {
  /**
   * Default ring-buffer capacity per event-name for backfill. SSE clients reconnecting with
   * `Last-Event-ID` get the missed events from this buffer.
   */
  private readonly bufferSize: number;
  private readonly buffer: Array<{ id: number; event: string; data: EventBusPayload; ts: number }> = [];
  private nextId = 1;

  constructor(opts: { bufferSize?: number } = {}) {
    super();
    this.setMaxListeners(50); // dashboard + harness monitor + tests can attach many listeners
    this.bufferSize = opts.bufferSize ?? 1000;
  }

  /**
   * Emit + buffer. The buffer is FIFO with capacity `bufferSize`; older entries drop when full.
   * The numeric `id` doubles as the SSE event ID — SSE consumers can resume via Last-Event-ID.
   */
  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (typeof event === 'string') {
      const data = (args[0] as EventBusPayload | undefined) ?? {};
      this.buffer.push({ id: this.nextId++, event, data, ts: Date.now() });
      if (this.buffer.length > this.bufferSize) {
        this.buffer.shift();
      }
    }
    return super.emit(event, ...args);
  }

  /** Snapshot of buffered events newer than `afterId`. Used by SSE backfill. */
  snapshotAfter(afterId: number): Array<{ id: number; event: string; data: EventBusPayload; ts: number }> {
    return this.buffer.filter((e) => e.id > afterId);
  }

  /** All buffered events. Used by /transcript pagination on dashboard load. */
  all(): Array<{ id: number; event: string; data: EventBusPayload; ts: number }> {
    return this.buffer.slice();
  }
}
