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

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

/** Build a Firecrawl provider given an API key. Uses /v1/search. */
export function firecrawlProvider(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearchProvider {
  return async (input) => {
    const res = await fetchImpl(`${FIRECRAWL_BASE}/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: input.query, limit: input.count ?? 5 }),
    });
    if (!res.ok) throw new Error(`Firecrawl search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as FirecrawlResponse;
    const hits: WebSearchHit[] = (data.data ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? r.markdown?.slice(0, 240) ?? '',
    }));
    return { query: input.query, hits, provider: 'firecrawl' };
  };
}

interface FirecrawlResponse {
  data?: Array<{ title?: string; url?: string; description?: string; markdown?: string }>;
  success?: boolean;
}

// ── Firecrawl scrape (clean markdown; handles PDFs + dynamic pages) ──

export interface ScrapeInput { url: string; }
export interface ScrapeResult {
  markdown: string;
  metadata: { title?: string; description?: string; sourceUrl?: string; statusCode?: number };
  bytes: number;
}
export type Scraper = (input: ScrapeInput) => Promise<ScrapeResult>;

export function firecrawlScraper(apiKey: string, fetchImpl: typeof fetch = fetch): Scraper {
  return async ({ url }) => {
    const res = await fetchImpl(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });
    if (!res.ok) throw new Error(`Firecrawl scrape ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json() as { success?: boolean; data?: { markdown?: string; metadata?: Record<string, unknown> } };
    const md = data.data?.markdown ?? '';
    const meta = (data.data?.metadata ?? {}) as ScrapeResult['metadata'];
    return { markdown: md, metadata: meta, bytes: md.length };
  };
}

export async function webSearch(input: WebSearchInput, provider: WebSearchProvider): Promise<WebSearchResult> {
  return provider(input);
}
