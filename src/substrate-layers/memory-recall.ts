// MemoryRecallLayer — renders the cycle's memory recall results (FR-076, FR-076b).
//
// Per contracts/prompt-stack-layers.md. The query template is FR-076's exact text:
//   "Goal: <top goal text>. Drive: <dominant drive label>. Last plan: <last plan précis>."
//
// FR-076b empty contract: when goals.top() AND lastPlan are BOTH empty, the layer renders
// null. This is the cycle-0 contract — no fabricated query, no echo of an empty goal stack
// pretending to be context.
//
// The cycle-context-builder runs `memory.query(queryText, topK)` and threads the results into
// `LayerContext.recalledNodes`. This layer renders them; it does NOT call memory itself.

import type { PromptLayer, LayerContext } from 'runcor-substrate';

const MAX_PRECIS_CHARS = 200;

export class MemoryRecallLayer implements PromptLayer {
  readonly name = 'memory_recall';

  render(context: LayerContext): string | null {
    // FR-076b: empty when goals AND lastPlan are both empty — no fabricated query.
    if (!context.topGoal && !context.lastPlanPrecis) {
      return null;
    }

    const nodes = context.recalledNodes ?? [];
    if (nodes.length === 0) {
      return null;
    }

    const lines = ['Recently relevant from memory:'];
    for (const node of nodes) {
      const tags = (node.tags ?? []).slice(0, 3).join(', ');
      const cycleStr = typeof node.created_cycle === 'number' ? `cycle ${node.created_cycle}` : 'cycle ?';
      const precis = node.content.length > MAX_PRECIS_CHARS
        ? `${node.content.slice(0, MAX_PRECIS_CHARS)}…`
        : node.content;
      lines.push(`  [M=${node.M.toFixed(2)}, ${cycleStr}${tags ? `, tags=${tags}` : ''}] ${precis.replace(/\n/g, ' ')}`);
    }
    return lines.join('\n');
  }
}
