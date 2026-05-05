// Transcript endpoint — recent decisions + actions, plus SSE for live tail.

import type { ServerResponse } from 'node:http';
import type { KindContext, TranscriptEvent } from '../types.js';

export function recentTranscript(ctx: KindContext, kind: 'v2' | 'control', limit = 50): unknown {
  const cycles = ctx.store.cyclesFor(kind);
  const recent = cycles.slice(-limit);
  const out: Array<{
    cycleId: number; cycleNumber: number; status: string; startedAt: string; completedAt?: string;
    decisions: ReturnType<typeof ctx.store.decisionsFor>;
    actions: ReturnType<typeof ctx.store.actionsFor>;
  }> = [];
  for (const c of recent) {
    out.push({
      cycleId: c.id,
      cycleNumber: c.cycleNumber,
      status: c.status,
      startedAt: c.startedAt,
      ...(c.completedAt !== undefined ? { completedAt: c.completedAt } : {}),
      decisions: ctx.store.decisionsFor(c.id),
      actions: ctx.store.actionsFor(c.id),
    });
  }
  return out;
}

/** SSE pump: write Server-Sent Event headers and a writer function. */
export function attachSseStream(res: ServerResponse): (event: TranscriptEvent) => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Initial comment as keep-alive ping.
  res.write(': connected\n\n');
  return (event: TranscriptEvent): void => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

/** In-process pub/sub for SSE clients. The agent runner can call broadcast() on each event. */
export class TranscriptBus {
  private subscribers = new Set<(e: TranscriptEvent) => void>();

  subscribe(fn: (e: TranscriptEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  broadcast(event: TranscriptEvent): void {
    for (const fn of this.subscribers) {
      try { fn(event); } catch { /* swallow individual subscriber errors */ }
    }
  }

  size(): number { return this.subscribers.size; }
}
