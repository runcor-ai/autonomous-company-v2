// Direct OpenRouter caller for the external rater (observer-side; permitted by lint).
//
// The rater is NOT part of the agent's call path. It scores daily summaries against a frozen
// rubric and persists results to rater.db. Scores never re-enter the agent (Principle III).
// Direct provider call is acceptable here because the substrate gate is irrelevant — there's
// no agent prompt to gate.

export interface OpenRouterCallArgs {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Token cap. Default 600. */
  maxTokens?: number;
}

export interface OpenRouterResponse {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export async function callOpenRouterChat(args: OpenRouterCallArgs): Promise<OpenRouterResponse> {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model: args.model,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
    max_tokens: args.maxTokens ?? 600,
    temperature: 0,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://runcor.ai',
      'X-Title': 'runcor-v2-rater',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[rater] OpenRouter ${res.status}: ${res.statusText} — ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? args.model,
    ...(data.usage
      ? { usage: { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } }
      : {}),
  };
}
