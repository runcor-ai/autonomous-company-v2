// Action: schedule_self — request a future cycle (or webhook subscription).

export interface ScheduleSelfInput {
  /** ISO timestamp when the next wake should fire. */
  wakeAt: string;
  /** Free-form rationale persisted alongside the schedule. */
  reason?: string;
}

export interface ScheduleSelfResult {
  scheduledFor: string;
  delayMs: number;
}

export interface SelfScheduler {
  schedule(input: ScheduleSelfInput): Promise<ScheduleSelfResult>;
  /** Returns the next pending wake or null if none. */
  nextWake(): { wakeAt: string; reason?: string } | null;
  /** Clears the next wake (caller should fire it). */
  consumeNext(): { wakeAt: string; reason?: string } | null;
}

export function createSelfScheduler(nowFn: () => Date = () => new Date()): SelfScheduler {
  let pending: { wakeAt: string; reason?: string } | null = null;
  return {
    async schedule(input) {
      const target = new Date(input.wakeAt).getTime();
      const delayMs = Math.max(0, target - nowFn().getTime());
      pending = { wakeAt: input.wakeAt, ...(input.reason !== undefined ? { reason: input.reason } : {}) };
      return { scheduledFor: input.wakeAt, delayMs };
    },
    nextWake() { return pending; },
    consumeNext() { const p = pending; pending = null; return p; },
  };
}
