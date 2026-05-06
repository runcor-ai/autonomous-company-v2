// fs_read (T065) — read a file from the agent's scratchpad volume.
//
// Per contracts/mcp-local-tools.md. Read-only. Path safety: rejects `..` segments and
// absolute paths; only accepts paths under SCRATCHPAD_DIR.

import { readFile, stat } from 'node:fs/promises';
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

export const fsRead: LocalToolFactory = (deps) => ({
  name: 'fs_read',
  description: "Read a file from the agent's scratchpad. Read-only.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', pattern: '^[a-zA-Z0-9_\\-/.]+$' },
    },
    required: ['path'],
  },
  handler: async (args) => {
    const p = typeof args.path === 'string' ? args.path : '';
    if (!p) return errResult('path required');
    const target = safeJoin(deps.env.scratchpadDir, p);
    if (!target) return errResult('path_traversal_rejected');

    try {
      const st = await stat(target);
      if (st.size > MAX_BYTES) {
        return errResult('too_large', { sizeBytes: st.size, maxBytes: MAX_BYTES });
      }
      const content = await readFile(target, 'utf8');
      return okResult({ content, sizeBytes: st.size });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return errResult('not_found');
      return errResult(err instanceof Error ? err.message : 'fs_read_failure');
    }
  },
});
