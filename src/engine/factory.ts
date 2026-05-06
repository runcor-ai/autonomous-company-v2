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
  const defaultModel = opts.defaultModel ?? 'openrouter/auto';
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

  const engineConfig: EngineConfig = {
    model: { provider },
  };

  return createEngine(engineConfig);
}
