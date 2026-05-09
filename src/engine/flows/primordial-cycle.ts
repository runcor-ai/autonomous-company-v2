// Primordial-cycle flow handler (T057, FR-010).
//
// Registered with the engine at boot via `engine.register('primordial-cycle', handler)`.
// V2's cycle protocol invokes one of these per cycle via
// `engine.trigger('primordial-cycle', { idempotencyKey, input: { layerContext, userPrompt } })`.
//
// The handler makes ONE `ctx.model.complete(...)` call. The substrate's installer (monkey-patched
// onto the model router at boot) intercepts: prepends the layered system prompt assembled from
// the registered PromptLayers, runs the discernment gate post-call (retry-then-flag mode when
// memory is wired in, per FR-019b–FR-019f), and returns the best-of-three response on exhaustion.
//
// V2 attaches the `LayerContext` to the request via the agreed-upon `__substrateLayerContext`
// marker the substrate consumes (and strips before forwarding). Callers do NOT bypass this — the
// boot's lint guard at src/shared/lints/no-direct-provider.ts ensures all model calls flow
// through the engine.

import type { LayerContext } from 'runcor-substrate';
import type { Runcor } from 'runcor';

export interface PrimordialCycleInput {
  layerContext: LayerContext;
  /**
   * The user-side prompt for this cycle. Typically the cycle's instruction text (e.g.,
   * "Choose your next action.") — the layered system prompt is composed by the substrate
   * from the registered PromptLayers, NOT by V2.
   */
  userPrompt: string;
  /** Optional model override; defaults to engine config. */
  model?: string;
  /** Optional max output tokens. */
  maxTokens?: number;
  temperature?: number;
}

export interface PrimordialCycleOutput {
  /** Raw model response text — the cycle protocol parses for the chosen action. */
  text: string;
  model: string;
  provider?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Register the primordial-cycle flow with the engine. Idempotent — calling twice is harmless
 * (the engine's `register` would throw on duplicates; we guard via `listFlows()`).
 */
export function registerPrimordialCycleFlow(engine: Runcor): void {
  if (engine.listFlows().some((f) => f.name === 'primordial-cycle')) {
    return;
  }

  engine.register(
    'primordial-cycle',
    async (ctx) => {
      const input = ctx.input as PrimordialCycleInput;
      if (!input || typeof input !== 'object' || !input.layerContext || !input.userPrompt) {
        throw new Error(
          'primordial-cycle flow requires input: { layerContext: LayerContext, userPrompt: string }',
        );
      }

      const request: Parameters<typeof ctx.model.complete>[0] & {
        __substrateLayerContext?: LayerContext;
      } = {
        prompt: input.userPrompt,
        // Force JSON mode — nemotron-3-super was leaking chain-of-thought prose
        // ("We are at cycle 0", "Ensure correct formatting") in place of action JSON.
        // OpenRouter's response_format: json_object on this model produces strict JSON.
        responseFormat: 'json',
        ...(input.model ? { model: input.model } : {}),
        ...(typeof input.maxTokens === 'number' ? { maxTokens: input.maxTokens } : {}),
        ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
        __substrateLayerContext: input.layerContext,
      };

      const response = await ctx.model.complete(request);

      const out: PrimordialCycleOutput = {
        text: response.text,
        model: response.model ?? input.model ?? 'unknown',
        ...(response.provider ? { provider: response.provider } : {}),
        ...(response.usage ? { usage: response.usage } : {}),
      };
      return out;
    },
    // No flow-level retry; the substrate handles retry-then-flag, and modelRouter handles
    // intra-provider retry. Adding flow retries would compound retries unpredictably.
    { maxRetries: 0 },
  );
}
