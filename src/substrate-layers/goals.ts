// GoalsLayer — renders the current P/O/I goal stack (FR-014, FR-001).
//
// Per contracts/prompt-stack-layers.md. Empty at cycle 0 (FR-001 — discovered, not seeded)
// and any cycle where the goal stack is empty.

import type { PromptLayer, LayerContext } from 'runcor-substrate';

export class GoalsLayer implements PromptLayer {
  readonly name = 'goals';

  render(context: LayerContext): string | null {
    if (!context.topGoal) return null;
    // The LayerContext shape only carries `topGoal` directly; full P/O/I rendering happens
    // when the boot/cycle-context plumbing surfaces a stack. We render the top goal alone
    // until a richer stack is threaded through.
    const cat = context.topGoal.category ?? 'goal';
    return ['Goals:', `  ${cat}: ${context.topGoal.text}`].join('\n');
  }
}
