// terminate (T070) — end the agent's run (FR-050, FR-052, FR-110).
//
// Per contracts/mcp-local-tools.md. Records reason as MemoryNode tagged
// `['termination', 'cycle:<N>']`, sets the boot-supplied terminate signal so the cycle loop
// exits cleanly. Result.md generation + dashboard `terminated` reflection are downstream
// effects (handled by agent/index.ts after the cycle loop returns).
//
// Reason is OPTIONAL (changed 2026-05-08 after live observation: agent at cycle 213 had
// defensible reasoning to terminate but called terminate({}) without args — strict
// validation rejected the call, agent's intent was lost, cycle continued. Per Principle IV
// "termination is the agent's exclusive verb" — the affordance shouldn't gate on argument
// completeness. If the agent doesn't pass a reason, default to one that captures the
// observable fact: it chose to terminate without saying why, which IS itself a discovered
// stance worth recording).

import type { LocalToolFactory } from '../types.js';
import { okResult } from '../tool-result.js';

const DEFAULT_REASON = 'Agent-initiated termination; no reason provided.';

export const terminate: LocalToolFactory = (deps) => ({
  name: 'terminate',
  description:
    "End this agent's run. Final summary is produced before exit. Cannot be reversed. The `reason` argument is optional — passing one helps observers understand the choice, but its absence will not block termination.",
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', maxLength: 1000 },
    },
    // No `required` field — reason is optional.
  },
  handler: async (args) => {
    const rawReason = typeof args.reason === 'string' ? args.reason.trim() : '';
    const reason = rawReason.length > 0 ? rawReason : DEFAULT_REASON;
    const reasonProvided = rawReason.length > 0;

    const cycle = deps.context.cycle();
    try {
      await deps.memory.record(`Termination at cycle ${cycle}: ${reason}`, {
        tags: ['termination', `cycle:${cycle}`, ...(reasonProvided ? [] : ['no_reason_given'])],
        R: 1.0,
      });
    } catch {
      // best-effort — termination should still proceed even if memory write fails
    }
    deps.requestTerminate(reason);
    return okResult({ terminated: true, cycle, reason, reasonProvided });
  },
});
