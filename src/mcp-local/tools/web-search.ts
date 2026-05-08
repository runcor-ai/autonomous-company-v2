// web_search (T068) — search the web; returns top results with snippets.
//
// Per contracts/mcp-local-tools.md. Provider priority (operator-decided 2026-05-08):
//   1. FIRECRAWL_API_KEY → Firecrawl /v1/search (DEFAULT; same provider already used for
//      firecrawl_scrape — single API key, single rate-limit budget, single ops surface).
//   2. WEB_SEARCH_API_KEY → Brave Search API (fallback when Firecrawl errors).
//   3. neither → "unconfigured" error.
// Pre-2026-05-08 the order was reversed (Brave primary, Firecrawl unused) which led the
// freshly-reset agent to hit `web_search_unconfigured` every cycle for 20+ cycles even
// though the agent had a working Firecrawl key sitting right there. Web_search is the
// agent's most-chosen tool when curiosity dominates — it has to actually work.

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

interface FirecrawlSearchResult {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
}

async function searchBrave(apiKey: string, query: string, limit: number): Promise<{ results: Array<{ title: string; url: string; snippet: string }> } | { error: string }> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) return { error: `brave ${res.status}: ${res.statusText}` };
  const data = (await res.json()) as { web?: { results?: BraveResult[] } };
  const results = (data.web?.results ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));
  return { results };
}

async function searchFirecrawl(apiKey: string, query: string, limit: number): Promise<{ results: Array<{ title: string; url: string; snippet: string }> } | { error: string }> {
  const res = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: `firecrawl ${res.status}: ${res.statusText} — ${body.slice(0, 200)}` };
  }
  const data = (await res.json()) as { data?: FirecrawlSearchResult[] };
  const results = (data.data ?? []).slice(0, limit).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? r.markdown?.slice(0, 200) ?? '',
  }));
  return { results };
}

export const webSearch: LocalToolFactory = (deps) => ({
  name: 'web_search',
  description: 'Search the web. Returns title + url + snippet for top results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const firecrawlKey = deps.env.firecrawlApiKey;
    const braveKey = deps.env.webSearchApiKey;
    if (!firecrawlKey && !braveKey) {
      return errResult('web_search_unconfigured', {
        hint: 'Set FIRECRAWL_API_KEY (default) or WEB_SEARCH_API_KEY (Brave fallback).',
      });
    }

    const query = typeof args.query === 'string' ? args.query : '';
    const limit = typeof args.limit === 'number' ? Math.min(20, Math.max(1, args.limit)) : 10;
    if (!query) return errResult('query required');

    try {
      // Firecrawl is default. Try it first; on error, fall back to Brave if configured.
      if (firecrawlKey) {
        const primary = await searchFirecrawl(firecrawlKey, query, limit);
        if (!('error' in primary)) {
          return okResult({ query, provider: 'firecrawl', results: primary.results });
        }
        if (braveKey) {
          const fallback = await searchBrave(braveKey, query, limit);
          if (!('error' in fallback)) {
            return okResult({ query, provider: 'brave', firecrawlError: primary.error, results: fallback.results });
          }
          return errResult(`firecrawl failed (${primary.error}); brave also failed (${fallback.error})`);
        }
        return errResult(primary.error);
      }

      // Only Brave configured.
      const result = await searchBrave(braveKey!, query, limit);
      return 'error' in result
        ? errResult(result.error)
        : okResult({ query, provider: 'brave', results: result.results });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'web_search_failure');
    }
  },
});
