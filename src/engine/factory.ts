// Engine factory — single source for V2 + control engine creation (FR-100, G6).
//
// Both V2 and control processes call this factory; the resulting `Runcor` instance is
// configured with an OpenRouter provider and supports `transport: 'in-process'` adapters
// via runcor v0.3.1+'s default-in-process-factory behavior (no custom AdapterFactory
// injection required at construction time).
//
// This is the ONLY V2 file allowed to import / use a model-provider client directly (per
// FR-010 + the lint guard at src/shared/lints/no-direct-provider.ts). Adding new providers
// here is fine; doing so anywhere else is a Principle-V violation.

import { createEngine } from 'runcor';
import type { EngineConfig } from 'runcor';
import type { ModelProvider, ModelRequest, ModelResponse } from 'runcor/dist/model/provider.js';

export interface CreateV2EngineOptions {
  /** OpenRouter API key. */
  openrouterApiKey: string;
  /** Default model slug for OpenRouter routing. */
  defaultModel?: string;
  /** Provider name (defaults to 'openrouter'). */
  providerName?: string;
}

/**
 * Build an OpenRouter ModelProvider. Only this function is permitted to construct a direct
 * provider client per FR-010. The provider implements runcor's ModelProvider interface
 * (`name` + `complete`); runcor's substrate installer wraps `complete` calls automatically
 * once `substrate.installer.install(engine)` runs.
 */
function makeOpenRouterProvider(opts: CreateV2EngineOptions): ModelProvider {
  const providerName = opts.providerName ?? 'openrouter';
  // PINNED — was 'openrouter/auto' which routes adaptively. Live 2026-05-09: auto
  // selected GPT-5.4 Pro for complex substrate-stacked prompts and burned $30 on
  // two calls. Explicit model = no surprise routing.
  const defaultModel = opts.defaultModel ?? 'google/gemini-2.5-flash-lite';
  return {
    name: providerName,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const url = 'https://openrouter.ai/api/v1/chat/completions';
      const messages = request.messages
        ? request.messages.map((m) => ({ role: m.role, content: m.content }))
        : [
            ...(request.systemPrompt ? [{ role: 'system' as const, content: request.systemPrompt }] : []),
            { role: 'user' as const, content: request.prompt ?? '' },
          ];
      const body: Record<string, unknown> = { model: defaultModel, messages };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
      if (request.responseFormat === 'json') body.response_format = { type: 'json_object' };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.openrouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://runcor.ai',
          'X-Title': 'runcor-v2',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = new Error(`OpenRouter ${res.status}: ${res.statusText}`);
        (err as Error & { statusCode?: number }).statusCode = res.status;
        throw err;
      }
      const data = (await res.json()) as {
        choices?: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
        model?: string;
      };
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        model: data.model ?? defaultModel,
        provider: providerName,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Create a runcor engine instance configured for V2-002. Returns a `Runcor` instance with:
 *   - OpenRouter as the single provider (intra-provider retry from runcor v0.2.0+ active)
 *   - Default in-process adapter factory available via runcor v0.3.1+ auto-fallback
 *
 * The engine is returned ready for substrate installation (`substrate.installer.install(engine)`)
 * and adapter registration (`engine.addAdapter({ transport: 'in-process', tools: [...] })`).
 */
export async function createV2Engine(options: CreateV2EngineOptions) {
  const provider = makeOpenRouterProvider(options);

  // costPerToken enables runcor's CostTracker — without it, no `cost:request` events
  // fire and the spent meter stays at $0, breaking the budget cap.
  // Numbers are a blended OpenRouter approximation (V2 routes across Nemotron / Qwen /
  // Llama / Gemini Flash etc; per-model exact pricing isn't available without a model
  // routing config). Conservative upper-bound: ~$1/1M input, ~$3/1M output. This will
  // over-estimate slightly vs actual OpenRouter invoice — fine for budget-cap purposes
  // (terminates a bit before the true $5 instead of after).
  const engineConfig: EngineConfig = {
    model: {
      providers: [
        { provider, costPerToken: { input: 0.000001, output: 0.000003 } },
      ],
    },
  };

  return createEngine(engineConfig);
}
