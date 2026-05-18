// MetaPressureLayer — surfaces runcor-meta's pressure signal into the prompt stack.
//
// runcor-meta tracks a calibration store (trajectory scores over time) and computes a
// PressureSignal: {intensity, label, evidence}. High pressure = recent trajectories have
// been poor → agent should be more cautious. The signal exists per probe #11; this layer
// makes it actionable by injecting it into the prompt.
//
// Placed between DrivesLayer and GoalsLayer in the stack: pressure is a meta-drive —
// distinct from the four base drives (resource/curiosity/reactivity/coherence) because
// it's drawn from the agent's own trajectory history, not from environment events.

import type { PromptLayer, LayerContext } from 'runcor-substrate';
import type { Meta } from 'runcor-meta';

export class MetaPressureLayer implements PromptLayer {
  readonly name = 'meta_pressure';
  // Getter pattern: Meta is constructed AFTER the prompt-stack is registered in V2's boot.
  // The layer holds a getter that resolves to the live Meta instance when render() runs.
  constructor(private readonly getMeta: () => Meta | null) {}

  render(_context: LayerContext): string {
    const meta = this.getMeta();
    if (!meta) return '';
    let signal;
    try {
      signal = meta.pressure();
    } catch {
      return '';
    }
    if (!signal || signal.basedOn === 0) return '';
    const lines = [`Self-monitoring pressure (cadence suggestion: ${signal.suggestedCadence}):`];
    if (signal.recentQuality !== null) {
      lines.push(`  recent trajectory quality: ${signal.recentQuality.toFixed(2)}/1.00 (based on last ${signal.basedOn} trajectories)`);
    }
    if (signal.recentEscalations > 0) {
      lines.push(`  recent escalations: ${signal.recentEscalations} — drift in recent trajectories`);
    }
    return lines.join('\n');
  }
}
