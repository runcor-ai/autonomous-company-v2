// Shared types for V2's local MCP module (FR-200).
//
// V2's local MCP module exposes a fixed set of inherited outward actions (Firecrawl,
// IMAP/SMTP, git, fs, web search, publish_post, terminate). Each tool is built as a
// `LocalToolFactory` that takes a `LocalToolDeps` bag and returns a runcor
// `AdapterToolDefinition`. Boot composes the deps from env + memory and registers all
// returned tools with the engine via `engine.addAdapter({ transport: 'in-process', tools })`.
//
// Tool handlers must return a `ToolCallResult` per runcor's MCP shape — V2 wraps every
// result via `okResult` / `errResult` helpers in `tool-result.ts`.

import type { AdapterToolDefinition, ToolCallResult } from 'runcor';
import type { MemorySystem } from 'runcor-memory';
import type { DataCube } from 'runcor-data';
import type { V2Env } from '../shared/env.js';

export type { AdapterToolDefinition, ToolCallResult };

/**
 * Per-cycle context the boot wires through to tool handlers via closure. The cycle counter
 * advances each cycle; tools that persist data (publish_post, terminate, fs_write) read
 * `cycle()` lazily so they observe the current cycle, not the cycle at boot.
 */
export interface LocalToolContext {
  cycle(): number;
  dayOfRun(): number;
}

export interface LocalToolDeps {
  env: V2Env;
  memory: MemorySystem;
  dataCube: DataCube;
  agentRole: 'v2' | 'control';
  context: LocalToolContext;
  /** Signal handler — terminate tool sets this to halt the cycle loop. */
  requestTerminate(reason: string): void;
}

export type LocalToolFactory = (deps: LocalToolDeps) => AdapterToolDefinition;

export const LOCAL_ADAPTER_NAME = 'v2-local-actions' as const;
