// TemporalContextLayer — renders wall-clock time + cycle + day-of-run into the prompt
// stack. Without this, the model can't tell whether two consecutive cycles are
// "the next morning" or "two seconds apart" — and tends to hallucinate dates from
// pre-training (observed 2026-05-09: nemotron wrote "## 2024-06-01" in a journal
// entry that should have been 2026-05-09).
//
// Placed between SeedLayer and RealityLayer: role context first ("you are CEO"),
// then current temporal state ("it's day 1, cycle 18, 09:15 UTC"), then the
// data-cube reality slice.

import type { PromptLayer, LayerContext } from 'runcor-substrate';

export class TemporalContextLayer implements PromptLayer {
  readonly name = 'temporal-context';
  constructor(private readonly getDay: () => number) {}

  render(context: LayerContext): string {
    const now = new Date();
    const iso = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const day = this.getDay();
    const cycle = context.cycle ?? 0;
    return [
      'Time:',
      `  Wall clock: ${iso}`,
      `  Cycle: ${cycle} of this run`,
      `  Day: ${day} of this run`,
      '  Note: "first cycle of each day" applies only on day-boundary cycles, not every cycle.',
    ].join('\n');
  }
}
