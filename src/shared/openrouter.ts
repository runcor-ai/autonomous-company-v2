// OpenRouter chat-completion client with cost tracking + budget enforcement.

import type { Store } from './db.js';
import type { AgentKind, BudgetStatus, DecisionRecord } from './types.js';

export type RoleSlot = 'player' | 'coach' | 'judge' | 'naive';

export interface ModelSpec {
  /** OpenRouter slug, e.g. 'nvidia/llama-3.1-nemotron-70b-instruct'. */
  slug: string;
  /** USD per million prompt tokens. */
  promptPricePerMTok: number;
  /** USD per million completion tokens. */
  completionPricePerMTok: number;
}

export const DEFAULT_MODELS: Record<RoleSlot, ModelSpec> = {
  player: { slug: 'nvidia/llama-3.1-nemotron-70b-instruct', promptPricePerMTok: 0.35, completionPricePerMTok: 0.40 },
  coach:  { slug: 'qwen/qwen-2.5-32b-instruct',             promptPricePerMTok: 0.27, completionPricePerMTok: 0.27 },
  judge:  { slug: 'meta-llama/llama-3.1-8b-instruct',        promptPricePerMTok: 0.05, completionPricePerMTok: 0.05 },
  naive:  { slug: 'nvidia/llama-3.1-nemotron-70b-instruct', promptPricePerMTok: 0.35, completionPricePerMTok: 0.40 },
};

export interface CompleteInput {
  role: RoleSlot;
  prompt: string;
  cycleId: number;
  /** Override model spec for this call. */
  model?: ModelSpec;
  /** Optional system prompt prepended. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CompleteResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  decision: DecisionRecord;
}

export class BudgetExceededError extends Error {
  constructor(public readonly status: BudgetStatus) {
    super(
      `runcor: budget exceeded for ${status.kind} ` +
      `(spent $${status.spentUsd.toFixed(4)} / cap $${status.capUsd.toFixed(2)})`,
    );
    this.name = 'BudgetExceededError';
  }
}

export interface OpenRouterClientOptions {
  apiKey: string;
  /** Per-agent USD cap. Calls reject when totalSpent + estimated >= cap. */
  budgetCapUsd: number;
  kind: AgentKind;
  store: Store;
  /** Override base URL (used in tests). */
  baseUrl?: string;
  /** Override fetch (used in tests). */
  fetchImpl?: typeof fetch;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterClient {
  private fetchImpl: typeof fetch;
  private baseUrl: string;
  constructor(private opts: OpenRouterClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? OPENROUTER_BASE;
  }

  budgetStatus(): BudgetStatus {
    const spent = this.opts.store.totalSpentUsd(this.opts.kind);
    return {
      kind: this.opts.kind,
      spentUsd: spent,
      capUsd: this.opts.budgetCapUsd,
      remainingUsd: Math.max(0, this.opts.budgetCapUsd - spent),
      exhausted: spent >= this.opts.budgetCapUsd,
    };
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    const status = this.budgetStatus();
    if (status.exhausted) throw new BudgetExceededError(status);

    const model = input.model ?? DEFAULT_MODELS[input.role];
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.slug,
        messages,
        max_tokens: input.maxTokens ?? 1024,
        temperature: input.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
    }
    const data = await res.json() as ORResponse;
    const text = data.choices[0]?.message?.content ?? '';
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const costUsd =
      (promptTokens / 1_000_000) * model.promptPricePerMTok +
      (completionTokens / 1_000_000) * model.completionPricePerMTok;

    const decision = this.opts.store.recordDecision({
      kind: this.opts.kind,
      cycleId: input.cycleId,
      role: input.role,
      model: model.slug,
      prompt: input.prompt,
      output: text,
      costUsd,
      promptTokens,
      completionTokens,
      createdAt: new Date().toISOString(),
    });

    return { text, promptTokens, completionTokens, costUsd, decision };
  }
}

interface ORResponse {
  choices: Array<{ message: { role: string; content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
