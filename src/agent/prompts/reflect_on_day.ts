// reflect-on-day prompt — assembled at day-end. Spec FR-035 / plan.md.
// MUST: ground every claim in the day's actual transcript (no fabrication).
// MUST: name what changed in identity, goals, drives, watchdog signals, coherence problems.
// MUST: end with one sentence on what tomorrow's open question is.
// MUST NOT: use commercial vocabulary unless the agent has discovered commercial activity.
// MUST NOT: speak about prior daily summaries' scores (the agent is blind to scores).

import type { Store } from '../../shared/db.js';
import type { AgentHarness } from '../boot.js';

export interface ReflectOnDayInput {
  dayNumber: number;
  cycleStart: number;  // first cycle of the day
  cycleEnd: number;    // last cycle of the day (inclusive)
  store: Store;
  harness: AgentHarness;
}

export function assembleReflectOnDayPrompt(input: ReflectOnDayInput): string {
  const cyclesInDay = input.store.cyclesFor('v2')
    .filter((c) => c.cycleNumber >= input.cycleStart && c.cycleNumber <= input.cycleEnd);

  const actionRows = cyclesInDay.flatMap((c) => input.store.actionsFor(c.id));
  const decisionRows = cyclesInDay.flatMap((c) => input.store.decisionsFor(c.id));

  const actionsSummary = actionRows.length === 0
    ? '(no actions taken)'
    : actionRows.map((a) => `  cycle ${a.cycleId}: ${a.action} ${typeof a.payload === 'object' ? JSON.stringify(a.payload).slice(0, 100) : a.payload}`).join('\n');

  let identityBlock = '(no self-theory)';
  try { identityBlock = input.harness.identity.renderBlock() || identityBlock; } catch { /* keep default */ }

  const goalsBlock = input.harness.goals.renderBlock(input.cycleEnd);
  const coherenceBlock = input.harness.coherence.renderBlock();

  const lines: string[] = [];
  lines.push(`REFLECTION CONTRACT (R++ spec):`);
  lines.push(`#> spec`);
  lines.push(`Goal: produce a single readable reflection (≤500 words) on day ${input.dayNumber}'s activity.`);
  lines.push(`MUST: ground every claim in the day's actual transcript (no fabrication).`);
  lines.push(`MUST: name what changed in identity, goals, drives, watchdog signals, coherence problems.`);
  lines.push(`MUST: end with one sentence on what tomorrow's open question is.`);
  lines.push(`MUST NOT: use commercial vocabulary unless the agent has discovered commercial activity.`);
  lines.push(`MUST NOT: speak about prior daily summaries' scores (you are blind to scores).`);
  lines.push('');
  lines.push(`DAY ${input.dayNumber} — cycles ${input.cycleStart}..${input.cycleEnd}`);
  lines.push('');
  lines.push(`ACTIONS THIS DAY:`);
  lines.push(actionsSummary);
  lines.push('');
  lines.push(`DECISIONS THIS DAY: ${decisionRows.length} dialectic round(s).`);
  lines.push('');
  lines.push(`IDENTITY (current):`);
  lines.push('  ' + identityBlock.split('\n').join('\n  '));
  lines.push('');
  lines.push(`GOALS (current):`);
  lines.push('  ' + goalsBlock.split('\n').join('\n  '));
  lines.push('');
  lines.push(`COHERENCE (current):`);
  lines.push('  ' + coherenceBlock.split('\n').join('\n  '));
  lines.push('');
  lines.push(`Reply with ONLY the reflection text — no JSON, no preamble. ≤500 words.`);
  return lines.join('\n');
}
