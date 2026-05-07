// Persist the EventBus buffer to disk so cycle-by-cycle history survives
// redeploys. Writes events as JSONL (one JSON object per line) appended to
// a single file under <agent-state>/bus-events.jsonl. On boot, the latest
// N entries are loaded back into the bus to seed the in-process buffer.
//
// This keeps the transcript pane showing real history (not just the events
// since the last process start).

import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import type { EventBus } from './event-bus.js';

export interface PersistedEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
  ts: number;
}

const KEEP_LAST = 4000; // matches default bus buffer size
const PRUNE_EVERY = 200; // every N writes, rewrite the file with only the last KEEP_LAST entries

/**
 * Wire bus persistence. Returns a stop() function (no-op for production; useful for tests).
 */
export function startBusPersistence(args: { bus: EventBus; filePath: string }): () => void {
  const { bus, filePath } = args;
  let writesSinceLastPrune = 0;

  // Step 1: hydrate bus from disk (if a prior process wrote events).
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.length > 0);
      const recent = lines.slice(-KEEP_LAST);
      let hydrated = 0;
      for (const line of recent) {
        try {
          const ev = JSON.parse(line) as PersistedEvent;
          // Re-emit silently to populate buffer; downstream listeners (like SSE
          // forwarder) will receive these too — that's fine, they're effectively
          // a backfill on a fresh subscriber.
          bus.emit(ev.event, ev.data);
          hydrated += 1;
        } catch { /* skip corrupt line */ }
      }
      console.log(`[bus-persist] hydrated ${hydrated} events from ${filePath}`);
    } catch (err) {
      console.error('[bus-persist] hydrate failed:', err);
    }
  }

  // Step 2: append every new event to disk.
  const eventTypes = [
    'cycle_record', 'prompt_assembled', 'discernment', 'discernment_flagged',
    'flag_burst_warning', 'cost_request', 'execution_state_change',
    'execution_complete', 'adapter_tool_call', 'adapter_connected',
    'adapter_disconnected', 'provider_health_change', 'next_wake_scheduled',
    'day_boundary', 'startup_record', 'harness_engaged', 'harness_disengaged',
    'result_published',
  ];
  const handlers: Array<{ event: string; fn: (data: Record<string, unknown>) => void }> = [];
  for (const et of eventTypes) {
    const fn = (data: Record<string, unknown>): void => {
      try {
        const line = JSON.stringify({ event: et, data: data ?? {}, ts: Date.now() }) + '\n';
        appendFileSync(filePath, line, 'utf-8');
        writesSinceLastPrune += 1;
        if (writesSinceLastPrune >= PRUNE_EVERY) {
          prune(filePath, KEEP_LAST);
          writesSinceLastPrune = 0;
        }
      } catch (err) {
        // Don't kill the cycle loop if disk write fails; just log once-ish.
        if (writesSinceLastPrune === 0) console.error('[bus-persist] append failed:', err);
      }
    };
    bus.on(et, fn);
    handlers.push({ event: et, fn });
  }

  return (): void => {
    for (const h of handlers) bus.off(h.event, h.fn);
  };
}

function prune(filePath: string, keepLast: number): void {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);
    if (lines.length <= keepLast) return;
    writeFileSync(filePath, lines.slice(-keepLast).join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.error('[bus-persist] prune failed:', err);
  }
}
