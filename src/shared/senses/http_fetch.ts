// Sense: http_fetch — read any URL.

export interface HttpFetchInput {
  url: string;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  /** Maximum body bytes to read (cap to avoid runaway downloads). */
  maxBytes?: number;
  /** Request timeout ms. */
  timeoutMs?: number;
}

export interface HttpFetchResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

const DEFAULT_MAX_BYTES = 256_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export async function httpFetch(input: HttpFetchInput, fetchImpl: typeof fetch = fetch): Promise<HttpFetchResult> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(input.url, {
      method: input.method ?? 'GET',
      ...(input.headers ? { headers: input.headers } : {}),
      signal: ctrl.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    let body = '';
    let truncated = false;
    const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
    if (input.method !== 'HEAD') {
      const text = await res.text();
      if (text.length > maxBytes) { body = text.slice(0, maxBytes); truncated = true; }
      else body = text;
    }
    return { status: res.status, ok: res.ok, headers, body, truncated };
  } finally {
    clearTimeout(timeout);
  }
}
