// firecrawl_scrape (T061) — scrape a URL via Firecrawl API.
//
// Per contracts/mcp-local-tools.md. Returns rendered markdown. Caches successful scrapes in
// `runcor-data` so subsequent fetch_chunk calls can read pages without re-scraping.

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

export const firecrawlScrape: LocalToolFactory = (deps) => ({
  name: 'firecrawl_scrape',
  description: 'Scrape a single URL via Firecrawl. Returns rendered markdown.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
    },
    required: ['url'],
  },
  handler: async (args) => {
    const url = typeof args.url === 'string' ? args.url : '';
    if (!url) return errResult('url required');

    const apiKey = deps.env.firecrawlApiKey;
    if (!apiKey) {
      return errResult('firecrawl_unconfigured', { hint: 'FIRECRAWL_API_KEY not set' });
    }

    try {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      });
      if (!res.ok) {
        return errResult(`firecrawl ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { data?: { markdown?: string } };
      const markdown = data.data?.markdown ?? '';

      // Cache via runcor-data so fetch_chunk can read later without re-scraping.
      const cycle = deps.context.cycle();
      try {
        await deps.dataCube.ingest({
          cycle,
          source: 'firecrawl_scrape',
          payload: {
            url,
            markdown,
            cycle,
            cached_at: new Date().toISOString(),
            entity_type: 'web_chunk',
          },
        });
      } catch {
        // Cache best-effort; scrape result still returned.
      }

      return okResult({ url, markdown, cycle });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'firecrawl_failure');
    }
  },
});
