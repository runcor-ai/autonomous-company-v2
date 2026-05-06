// V2 RealityLayer — replaces substrate's default RealityLayer (FR-081, FR-082).
//
// runcor-data's `queryReality(...)` returns a RealitySlice whose `rendered: string` field is
// pre-formatted text describing entities + edges + open conflicts. V2 uses this directly —
// substrate's default RealityLayer expects substrate's own slice shape (entity_type / content /
// structured / confidence) which is the legacy v0.1.x DataNode form. The V2 RealityLayer
// reads `rendered` so the data cube owns the formatting.

import type { PromptLayer, LayerContext } from 'runcor-substrate';

interface RuncorDataRealitySlice {
  entities: unknown[];
  rendered?: string;
}

export class V2RealityLayer implements PromptLayer {
  readonly name = 'reality';

  render(context: LayerContext): string | null {
    const slice = context.realitySlice as unknown as RuncorDataRealitySlice | null;
    if (!slice || !Array.isArray(slice.entities) || slice.entities.length === 0) {
      return null;
    }
    if (typeof slice.rendered === 'string' && slice.rendered.trim().length > 0) {
      return slice.rendered;
    }
    // Defensive fallback if rendered text is missing — render a minimal summary.
    return `Reality: ${slice.entities.length} entities present.`;
  }
}
