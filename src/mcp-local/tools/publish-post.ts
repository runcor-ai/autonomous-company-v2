// publish_post (T069) — publish a daily summary as a MemoryNode (FR-062).
//
// Per contracts/mcp-local-tools.md. The summary lives in `runcor-memory` tagged
// `['daily_summary', 'day:<N>']`; visible at /blog within ~60s.
//
// No decay-exemption (FR-062b): summaries fade like any MemoryNode unless reinforced.

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

export const publishPost: LocalToolFactory = (deps) => ({
  name: 'publish_post',
  description: 'Publish today\'s daily summary. Persisted as a MemoryNode. Becomes visible at /blog within 60 seconds.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      content: { type: 'string', minLength: 1, maxLength: 5000 },
    },
    required: ['title', 'content'],
  },
  handler: async (args) => {
    const title = typeof args.title === 'string' ? args.title : '';
    const content = typeof args.content === 'string' ? args.content : '';
    if (!title || !content) return errResult('title/content required');

    const day = deps.context.dayOfRun();
    const cycle = deps.context.cycle();
    try {
      const result = await deps.memory.record(`# ${title}\n\n${content}`, {
        tags: ['daily_summary', `day:${day}`, `cycle:${cycle}`],
        R: 0.7,
      });
      return okResult({ nodeId: result.nodeId, day, cycle, action: result.action });
    } catch (err) {
      return errResult(err instanceof Error ? err.message : 'memory_record_failure');
    }
  },
});
