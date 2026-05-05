// OpenRouter chat client for the rater (mirrors callAnthropic's shape so
// rater.scoreSummary can use either via callImpl injection).
//
// Distinct from src/shared/openrouter.ts — that one is Store-coupled for
// cycle-cost accounting. The rater is observer-side, scores aren't part of
// the agent's budget.

import type { AnthropicCallInput, AnthropicCallResult } from './anthropic.js';

interface ORResponse {
  choices: Array<{ message: { role: string; content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

/** Same shape as callAnthropic so the rater can be agnostic about provider. */
export async function callOpenRouterChat(input: AnthropicCallInput): Promise<AnthropicCallResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.baseUrl ?? DEFAULT_BASE;
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_tokens: input.maxTokens ?? 256,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json() as ORResponse;
  const text = data.choices[0]?.message?.content ?? '';
  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}
