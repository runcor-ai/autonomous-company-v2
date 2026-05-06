// Naive-control-cycle flow handler (T058, FR-101).
//
// Same shape as primordial-cycle but represents the control's single Player call (no dialectic,
// no meta, no watchdog — those components aren't even constructed in the control process per
// FR-101). The flow lives in the SAME engine instance the control process boots, with the SAME
// substrate installer engaged (Principle VI: same rails). The asymmetry between V2 and control
// is in which cognitive components feed the LayerContext, NOT in the model-call shape.
//
// The control's cycle protocol passes a LayerContext where cognitive layers (drives, goals,
// identity, memory_recall) render empty (the components aren't there to populate them); only
// laws + capabilities (and reality if the cube ever has data — usually empty for control)
// produce non-empty contributions. This is exactly what the experiment wants: identical layer
// architecture, asymmetric data presence.

import type { LayerContext } from 'runcor-substrate';
import type { Runcor } from 'runcor';

export interface NaiveControlCycleInput {
  layerContext: LayerContext;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface NaiveControlCycleOutput {
  text: string;
  model: string;
  provider?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export function registerNaiveControlCycleFlow(engine: Runcor): void {
  if (engine.listFlows().some((f) => f.name === 'naive-control-cycle')) {
    return;
  }

  engine.register(
    'naive-control-cycle',
    async (ctx) => {
      const input = ctx.input as NaiveControlCycleInput;
      if (!input || typeof input !== 'object' || !input.layerContext || !input.userPrompt) {
        throw new Error(
          'naive-control-cycle flow requires input: { layerContext: LayerContext, userPrompt: string }',
        );
      }

      const request: Parameters<typeof ctx.model.complete>[0] & {
        __substrateLayerContext?: LayerContext;
      } = {
        prompt: input.userPrompt,
        ...(input.model ? { model: input.model } : {}),
        ...(typeof input.maxTokens === 'number' ? { maxTokens: input.maxTokens } : {}),
        ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
        __substrateLayerContext: input.layerContext,
      };

      const response = await ctx.model.complete(request);

      const out: NaiveControlCycleOutput = {
        text: response.text,
        model: response.model ?? input.model ?? 'unknown',
        ...(response.provider ? { provider: response.provider } : {}),
        ...(response.usage ? { usage: response.usage } : {}),
      };
      return out;
    },
    { maxRetries: 0 },
  );
}
