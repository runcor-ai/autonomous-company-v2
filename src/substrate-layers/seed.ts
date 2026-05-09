// SeedLayer — renders a role seed (PERSONA + BEHAVIOR + CHECKLIST) high in the prompt
// stack so identity reflection, goals proposal, and discernment all anchor on the role.
//
// Placed AFTER LawsLayer (laws are universal) and BEFORE RealityLayer (the role frames
// what counts as relevant reality). When no seed is loaded, the layer renders empty and
// V2 stays in void-seed mode.

import type { PromptLayer, LayerContext } from 'runcor-substrate';
import type { SeedSpec } from '../seeds/loader.js';

export class SeedLayer implements PromptLayer {
  readonly name = 'seed';
  constructor(private readonly seed: SeedSpec) {}

  render(_context: LayerContext): string {
    const lines: string[] = [];
    lines.push(`Role: ${this.seed.target}`);
    if (this.seed.persona) {
      lines.push('');
      lines.push('Persona:');
      lines.push(this.seed.persona);
    }
    if (this.seed.behavior) {
      lines.push('');
      lines.push('Behavior:');
      lines.push(this.seed.behavior);
    }
    if (this.seed.checklist) {
      lines.push('');
      lines.push('Checklist (what done looks like):');
      lines.push(this.seed.checklist);
    }
    return lines.join('\n');
  }
}
