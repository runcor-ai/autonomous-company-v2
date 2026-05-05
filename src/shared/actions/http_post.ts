// Action: http_post — make a POST/PUT/PATCH/DELETE call to any URL.

export interface HttpPostInput {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpPostResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function httpPost(
  input: HttpPostInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HttpPostResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const isJson = input.body !== undefined && typeof input.body !== 'string';
    const headers: Record<string, string> = { ...input.headers };
    if (isJson && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetchImpl(input.url, {
      method: input.method ?? 'POST',
      headers,
      ...(input.body !== undefined ? { body: isJson ? JSON.stringify(input.body) : (input.body as string) } : {}),
      signal: ctrl.signal,
    });
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { respHeaders[k] = v; });
    const text = await res.text();
    return { status: res.status, ok: res.ok, headers: respHeaders, body: text };
  } finally {
    clearTimeout(timeout);
  }
}
