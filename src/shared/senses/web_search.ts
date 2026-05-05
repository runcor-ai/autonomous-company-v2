// Sense: web_search — pluggable provider, default Brave.

export interface WebSearchInput {
  query: string;
  /** Max results to return. */
  count?: number;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  query: string;
  hits: WebSearchHit[];
  provider: string;
}

export type WebSearchProvider = (input: WebSearchInput) => Promise<WebSearchResult>;

const BRAVE_BASE = 'https://api.search.brave.com/res/v1/web/search';

/** Build a Brave provider given an API key. */
export function braveProvider(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  return async (input) => {
    const url = `${BRAVE_BASE}?q=${encodeURIComponent(input.query)}&count=${input.count ?? 5}`;
    const res = await fetchImpl(url, {
      headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Brave search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as BraveResponse;
    const hits: WebSearchHit[] = (data.web?.results ?? []).map((r) => ({
      title: r.title ?? '', url: r.url ?? '', snippet: r.description ?? '',
    }));
    return { query: input.query, hits, provider: 'brave' };
  };
}

interface BraveResponse {
  web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
}

export async function webSearch(input: WebSearchInput, provider: WebSearchProvider): Promise<WebSearchResult> {
  return provider(input);
}
