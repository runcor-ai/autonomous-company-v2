// Result helpers for V2's local MCP tools.
//
// Every tool handler returns a `ToolCallResult` with exactly one text content item carrying
// JSON. The engine forwards this through to the cycle protocol; cycle code parses the JSON
// to extract the tool's structured result. Errors set `isError: true` so the engine's
// `adapter:tool_call` event reports `success: false`.

import type { ToolCallResult } from 'runcor';

export function okResult(payload: unknown): ToolCallResult {
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify({ ok: true, ...(payload as object) }) }],
  };
}

export function errResult(error: string, extra?: Record<string, unknown>): ToolCallResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, error, ...(extra ?? {}) }),
      },
    ],
  };
}
