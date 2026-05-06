// DrivesLayer — renders the 4 drive pressures + dominant drive (FR-001).
//
// Per contracts/prompt-stack-layers.md. Always non-empty: drives are stateless and always
// defined, even at cycle 0 (resource pressure is non-zero because budget is finite).
//
// Substrate's PromptLayer interface: `render(context: LayerContext): string | null` —
// returning null/empty means the layer skips this cycle. DrivesLayer never returns null.

import type { PromptLayer, LayerContext } from 'runcor-substrate';

export class DrivesLayer implements PromptLayer {
  readonly name = 'drives';

  render(context: LayerContext): string {
    const d = context.drives;
    const dominantLabel = d.dominant?.label ?? this.computeDominant(d);
    return [
      'Drives:',
      `  resource:   ${d.resource.toFixed(2)}`,
      `  curiosity:  ${d.curiosity.toFixed(2)}`,
      `  reactivity: ${d.reactivity.toFixed(2)}`,
      `  coherence:  ${d.coherence.toFixed(2)}`,
      `dominant: ${dominantLabel}`,
    ].join('\n');
  }

  private computeDominant(d: LayerContext['drives']): string {
    const entries: Array<['resource' | 'curiosity' | 'reactivity' | 'coherence', number]> = [
      ['resource', d.resource],
      ['curiosity', d.curiosity],
      ['reactivity', d.reactivity],
      ['coherence', d.coherence],
    ];
    let bestLabel: string = 'resource';
    let bestVal = -Infinity;
    for (const [label, val] of entries) {
      if (val > bestVal) {
        bestVal = val;
        bestLabel = label;
      }
    }
    return bestLabel;
  }
}
