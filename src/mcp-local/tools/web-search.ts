// web_search (T068) — search the web; returns top results with snippets.
//
// Per contracts/mcp-local-tools.md. Provider is selected at boot. v0.2.0 supports Brave Search
// when WEB_SEARCH_API_KEY is set; degrades to "unconfigured" when absent.

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

export const webSearch: LocalToolFactory = (deps) => ({
  name: 'web_search',
  description: 'Search the web (Brave / SerpAPI / similar; provider chosen at boot per env).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
    },
    required: ['query'],
  },
  handler: async (args) => {
    const apiKey = deps.env.webSearchApiKey;
    if (!apiKey) return errResult('web_search_unconfigured', { hint: 'WEB_SEARCH_API_KEY not set' });

    const query = typeof args.query === 'string' ? args.query : '';
    const limit = typeof args.limit === 'number' ? Math.min(20, Math.max(1, args.limit)) : 10;
    if (!query) return errResult('query required');

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return errResult(`brave ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { web?: { results?: BraveResult[] } };
      const results = (data.web?.results ?? []).slice(0, limit).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.description ?? '',
      }));
      return okResult({ query, results });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'web_search_failure');
    }
  },
});
