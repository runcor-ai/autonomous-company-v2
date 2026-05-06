// IdentityLayer — renders the latest self-theory snapshot (FR-013, FR-001).
//
// Per contracts/prompt-stack-layers.md. Empty until first identity reflection completes.
// Source: latest MemoryNode tagged `['identity_snapshot']`, sorted by `created_cycle desc`.
// The cycle-context-builder fetches this and threads it through `LayerContext.identitySelfTheory`;
// the layer just renders.

import type { PromptLayer, LayerContext } from 'runcor-substrate';

const MAX_SELF_THEORY_CHARS = 800;

export class IdentityLayer implements PromptLayer {
  readonly name = 'identity';

  render(context: LayerContext): string | null {
    const text = context.identitySelfTheory;
    if (!text) return null;
    const trimmed = text.length > MAX_SELF_THEORY_CHARS ? `${text.slice(0, MAX_SELF_THEORY_CHARS)}…` : text;
    return ['Self-theory:', `  ${trimmed.replace(/\n/g, '\n  ')}`].join('\n');
  }
}
