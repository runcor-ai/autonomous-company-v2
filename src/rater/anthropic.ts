// Minimal Anthropic Messages API client — only what the rater needs.

export interface AnthropicCallInput {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
  /** Override base URL (for tests). */
  baseUrl?: string;
}

export interface AnthropicCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const DEFAULT_BASE = 'https://api.anthropic.com/v1';

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export async function callAnthropic(input: AnthropicCallInput): Promise<AnthropicCallResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const baseUrl = input.baseUrl ?? DEFAULT_BASE;
  const res = await fetchImpl(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      max_tokens: input.maxTokens ?? 256,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json() as AnthropicResponse;
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
