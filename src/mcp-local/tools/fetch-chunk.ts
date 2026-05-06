// fetch_chunk (T067) — fetch a chunk of a previously-scraped URL.
//
// Per contracts/mcp-local-tools.md. Reads from runcor-data's provenance / cache layer where
// firecrawl_scrape stored the full markdown. Allows deepfakes-article-style multi-cycle reads
// without paying re-scrape cost.

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

interface CachedWebChunk {
  url: string;
  markdown: string;
  cycle: number;
}

export const fetchChunk: LocalToolFactory = (deps) => ({
  name: 'fetch_chunk',
  description: "Return a chunk (default 4 KB) from a cached scrape. If url not cached, returns 'not_cached'.",
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      offset: { type: 'integer', minimum: 0, default: 0 },
      size: { type: 'integer', minimum: 256, maximum: 16_384, default: 4096 },
    },
    required: ['url'],
  },
  handler: async (args) => {
    const url = typeof args.url === 'string' ? args.url : '';
    const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
    const size = typeof args.size === 'number' ? Math.min(16_384, Math.max(256, args.size)) : 4096;
    if (!url) return errResult('url required');

    try {
      const matches = await deps.dataCube.search(url, { type: 'web_chunk', limit: 5 });
      const node = matches.find((n) => {
        const struct = n.structured as Partial<CachedWebChunk> | undefined;
        return struct?.url === url;
      });

      if (!node) return errResult('not_cached', { url });

      const struct = node.structured as Partial<CachedWebChunk>;
      const markdown = struct.markdown ?? '';
      const total = markdown.length;
      const chunk = markdown.slice(offset, offset + size);
      const hasMore = offset + size < total;
      return okResult({ url, offset, size, totalLength: total, hasMore, content: chunk });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'fetch_chunk_failure');
    }
  },
});
