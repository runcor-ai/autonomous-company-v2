// Operator pause state — in-memory flag flipped by /operator/pause and /operator/resume
// endpoints, polled by the cycle loop. When paused, the loop sleeps in 5s ticks until
// either the flag clears or the agent terminates.
//
// The dashboard server stays up while paused (it runs in the same process as the cycle
// loop but is event-loop-driven, so the cycle loop sleeping doesn't block HTTP). This
// gives the operator a "freeze and inspect" mode that doesn't require a redeploy.
//
// Per-role: V2 and control can be paused independently or together via scope='both'.
// Not persisted — pause state resets to running on every boot. That's intentional: the
// only way to halt the agent indefinitely is to terminate via the agent's own verb
// (Principle IV) or stop the deployment.

export type PauseScope = 'v2' | 'control' | 'both';

export class OperatorPauseState {
  private pausedV2 = false;
  private pausedControl = false;

  setPaused(scope: PauseScope, paused: boolean): void {
    if (scope === 'v2' || scope === 'both') this.pausedV2 = paused;
    if (scope === 'control' || scope === 'both') this.pausedControl = paused;
  }

  isPaused(role: 'v2' | 'control'): boolean {
    return role === 'v2' ? this.pausedV2 : this.pausedControl;
  }

  status(): { v2: boolean; control: boolean } {
    return { v2: this.pausedV2, control: this.pausedControl };
  }
}
