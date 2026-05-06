// fs_write (T066) — write a file to the agent's scratchpad volume.
//
// Per contracts/mcp-local-tools.md. Side-effecting (writes within scratchpad — recoverable).
// Path safety: rejects `..` and absolute paths.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

const MAX_BYTES = 1_000_000;

function safeJoin(root: string, p: string): string | null {
  if (path.isAbsolute(p) || p.includes('..')) return null;
  const resolved = path.resolve(root, p);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    return null;
  }
  return resolved;
}

export const fsWrite: LocalToolFactory = (deps) => ({
  name: 'fs_write',
  description: "Write a file to the agent's scratchpad. Overwrites without confirmation.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', pattern: '^[a-zA-Z0-9_\\-/.]+$' },
      content: { type: 'string', maxLength: MAX_BYTES },
    },
    required: ['path', 'content'],
  },
  handler: async (args) => {
    const p = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    if (!p) return errResult('path required');
    const target = safeJoin(deps.env.scratchpadDir, p);
    if (!target) return errResult('path_traversal_rejected');
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
      return errResult('too_large', { maxBytes: MAX_BYTES });
    }

    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
      return okResult({ sizeBytes: Buffer.byteLength(content, 'utf8'), ts: Date.now() });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'fs_write_failure');
    }
  },
});
