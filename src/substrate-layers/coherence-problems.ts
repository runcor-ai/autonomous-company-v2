// CoherenceProblemLayer — surfaces runcor-coherence's open problems into the prompt stack.
//
// runcor-coherence's `detect()` finds contradictions in accumulated state (different from
// runcor-watchdog's capability-gap detection — coherence catches contradictions BETWEEN
// pieces of accumulated state). Probe #13 showed V2 had read-only use of coherence; this
// layer makes its output a steering signal alongside WatchdogLayer.
//
// Placed between WatchdogLayer and CapabilitiesLayer: both are "problems with what's
// already true"; the agent reads them before deciding the next tool call.

import type { PromptLayer, LayerContext } from 'runcor-substrate';
import type { Coherence } from 'runcor-coherence';

const MAX_PROBLEMS_RENDERED = 5;

export class CoherenceProblemLayer implements PromptLayer {
  readonly name = 'coherence_problems';
  // Getter pattern (same reason as MetaPressureLayer): coherence is constructed after the
  // prompt-stack is registered.
  constructor(private readonly getCoherence: () => Coherence | null) {}

  render(_context: LayerContext): string {
    const coherence = this.getCoherence();
    if (!coherence) return '';
    let problems;
    try {
      problems = coherence.problems();
    } catch {
      return '';
    }
    if (!problems || problems.length === 0) return '';
    const lines = ['Coherence problems (contradictions in your accumulated state — needs resolution):'];
    for (const p of problems.slice(0, MAX_PROBLEMS_RENDERED)) {
      // Problem shape varies; render best-effort
      const text = (p as { description?: string; summary?: string; statement?: string }).description
        ?? (p as { summary?: string }).summary
        ?? (p as { statement?: string }).statement
        ?? JSON.stringify(p).slice(0, 200);
      const id = (p as { id?: string | number }).id;
      lines.push(`  - ${id !== undefined ? `[#${id}] ` : ''}${text.slice(0, 200)}`);
    }
    return lines.join('\n');
  }
}
