// Operator pause state — flag flipped by /operator/pause and /operator/resume endpoints,
// polled by the cycle loop. When paused, the loop sleeps in 5s ticks until the flag
// clears or the agent terminates.
//
// PERSISTED to the volume (`operator-pause-state.json`) so a redeploy doesn't silently
// un-pause the agent. Without persistence, every redeploy would resume cycling — which
// burns budget the operator didn't authorize. Hydrated on construction.
//
// Per-role: V2 and control can be paused independently or together via scope='both'.
//
// The dashboard server stays up while paused (it runs in the same process as the cycle
// loop but is event-loop-driven, so the cycle loop sleeping doesn't block HTTP). This
// gives the operator a "freeze and inspect" mode that doesn't require a redeploy.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type PauseScope = 'v2' | 'control' | 'both';

interface PausePersistShape {
  v2: boolean;
  control: boolean;
}

export class OperatorPauseState {
  private pausedV2 = false;
  private pausedControl = false;
  private readonly filePath: string | null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? null;
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PausePersistShape>;
        if (typeof parsed.v2 === 'boolean') this.pausedV2 = parsed.v2;
        if (typeof parsed.control === 'boolean') this.pausedControl = parsed.control;
        // eslint-disable-next-line no-console
        console.log(`[operator-pause] hydrated: v2=${this.pausedV2} control=${this.pausedControl}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[operator-pause] hydrate failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  setPaused(scope: PauseScope, paused: boolean): void {
    if (scope === 'v2' || scope === 'both') this.pausedV2 = paused;
    if (scope === 'control' || scope === 'both') this.pausedControl = paused;
    this.persist();
  }

  isPaused(role: 'v2' | 'control'): boolean {
    return role === 'v2' ? this.pausedV2 : this.pausedControl;
  }

  status(): { v2: boolean; control: boolean } {
    return { v2: this.pausedV2, control: this.pausedControl };
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      const data: PausePersistShape = { v2: this.pausedV2, control: this.pausedControl };
      writeFileSync(this.filePath, JSON.stringify(data), 'utf-8');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[operator-pause] persist failed:', err instanceof Error ? err.message : err);
    }
  }
}
