// terminate (T070) — end the agent's run (FR-050, FR-052, FR-110).
//
// Per contracts/mcp-local-tools.md. Records reason as MemoryNode tagged
// `['termination', 'cycle:<N>']`, sets the boot-supplied terminate signal so the cycle loop
// exits cleanly. Result.md generation + dashboard `terminated` reflection are downstream
// effects (handled by agent/index.ts after the cycle loop returns).

import type { LocalToolFactory } from '../types.js';
import { okResult, errResult } from '../tool-result.js';

export const terminate: LocalToolFactory = (deps) => ({
  name: 'terminate',
  description: "End this agent's run. Final summary is produced before exit. Cannot be reversed.",
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', minLength: 1, maxLength: 1000 },
    },
    required: ['reason'],
  },
  handler: async (args) => {
    const reason = typeof args.reason === 'string' ? args.reason : '';
    if (!reason) return errResult('reason required');

    const cycle = deps.context.cycle();
    try {
      await deps.memory.record(`Termination at cycle ${cycle}: ${reason}`, {
        tags: ['termination', `cycle:${cycle}`],
        R: 1.0,
      });
    } catch {
      // best-effort — termination should still proceed even if memory write fails
    }
    deps.requestTerminate(reason);
    return okResult({ terminated: true, cycle, reason });
  },
});
