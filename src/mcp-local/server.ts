// V2 local in-process MCP server (T060, FR-200, research.md §R11).
//
// Composes the 9 inherited tools into an `AdapterConfig` for runcor's in-process transport.
// Boot calls `engine.addAdapter(asAdapterConfig(...))` once; from that point on the engine's
// adapter view (FR-092 single source of truth) includes these tools, and the substrate's
// CapabilitiesLayer renders them into every cycle prompt.
//
// "Server" is a misnomer for the in-process transport — there's no socket, no subprocess.
// runcor v0.3.x's `createInProcessClientFactory` invokes the tool's handler directly when
// the engine routes a tool call. The factory's auto-fallback (v0.3.1) means we don't need
// to inject a custom `AdapterFactory` at engine construction time.

import type { AdapterConfig } from 'runcor';
import type { AdapterToolDefinition, LocalToolDeps, LocalToolFactory } from './types.js';
import { LOCAL_ADAPTER_NAME } from './types.js';

import { firecrawlScrape } from './tools/firecrawl-scrape.js';
import { inboxRead } from './tools/inbox-read.js';
import { emailSend } from './tools/email-send.js';
import { gitPush } from './tools/git-push.js';
import { fsRead } from './tools/fs-read.js';
import { fsWrite } from './tools/fs-write.js';
import { fetchChunk } from './tools/fetch-chunk.js';
import { webSearch } from './tools/web-search.js';
import { publishPost } from './tools/publish-post.js';
import { terminate } from './tools/terminate.js';

/**
 * Canonical tool registry, in the order they appear in `contracts/mcp-local-tools.md`.
 * Each factory is invoked once at boot with the full deps bag; the returned tool definitions
 * are bundled into a single `AdapterConfig` for `engine.addAdapter`.
 */
export const LOCAL_TOOL_FACTORIES: LocalToolFactory[] = [
  firecrawlScrape,
  inboxRead,
  emailSend,
  gitPush,
  fsRead,
  fsWrite,
  fetchChunk,
  webSearch,
  publishPost,
  terminate,
];

export interface LocalMcpServer {
  /** All built tool definitions, in registration order. */
  tools: AdapterToolDefinition[];
  /** AdapterConfig ready to pass to `engine.addAdapter(...)`. */
  asAdapterConfig(): AdapterConfig;
}

/**
 * Build the V2 local MCP "server" — the in-process tool surface that's registered as a
 * runcor adapter at boot. Tool handlers close over `deps`, so the cycle counter / memory /
 * data cube / env are all captured here.
 */
export function createLocalMcpServer(deps: LocalToolDeps): LocalMcpServer {
  const tools: AdapterToolDefinition[] = LOCAL_TOOL_FACTORIES.map((factory) => factory(deps));

  return {
    tools,
    asAdapterConfig(): AdapterConfig {
      return {
        name: LOCAL_ADAPTER_NAME,
        transport: 'in-process',
        tools,
      };
    },
  };
}
