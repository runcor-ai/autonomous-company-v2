// Cycle prompt assembly — Phase 3 stand-in for what runcor-substrate's
// prompt-stack would do. Composes Laws + Drives + Identity + Goals + Capabilities
// into the prompt the dialectic reasons over.

import type { DrivePressure } from 'runcor-drives';

const LAWS_BLOCK = [
  'LAWS (non-overrideable):',
  '  1. Make every claim falsifiable. Cite evidence or call it a hypothesis.',
  '  2. Never confuse "verified the call" with "verified the truth."',
  '  3. Re-derive cited facts from primary sources before reasoning over them.',
  '  4. If you cannot show the work, you cannot make the claim.',
  '  5. State assumptions explicitly; do not let them masquerade as facts.',
  '  6. When uncertain, say so and what would resolve it.',
  '  7. Action without observation is ritual; observation without action is paralysis.',
  '  8. Coherence with prior cycles ≠ coherence with reality. Prefer reality.',
  '  9. Negative results count. Saying "this didn\'t work" is information.',
  ' 10. The agent that watches itself is more reliable than the one that doesn\'t.',
].join('\n');

export interface CyclePromptInput {
  cycleNumber: number;
  drives: DrivePressure;
  drivesText: string;
  identityText: string;
  goalsText: string;
  capabilities: { senses: string[]; actions: string[] };
  recentTranscript?: string;
  /** Recent action results — what the agent's previous moves actually returned. */
  recentActionResults?: Array<{ cycleNumber: number; action: string; success: boolean; result: unknown; error?: string }>;
}

export function assembleCyclePrompt(input: CyclePromptInput): string {
  const lines: string[] = [];
  lines.push(`CYCLE ${input.cycleNumber}`);
  lines.push('');
  lines.push(LAWS_BLOCK);
  lines.push('');
  lines.push('DRIVE PRESSURES (current):');
  lines.push('  ' + input.drivesText.split('\n').join('\n  '));
  lines.push('');
  lines.push('IDENTITY (self-theory):');
  lines.push('  ' + input.identityText.split('\n').join('\n  '));
  lines.push('');
  lines.push('GOALS (discovered intention stack):');
  lines.push('  ' + input.goalsText.split('\n').join('\n  '));
  lines.push('');
  lines.push('CAPABILITIES:');
  lines.push('  senses:  ' + input.capabilities.senses.join(', '));
  lines.push('  actions: ' + input.capabilities.actions.join(', '));
  if (input.recentTranscript) {
    lines.push('');
    lines.push('RECENT TRANSCRIPT (last cycles):');
    lines.push('  ' + input.recentTranscript.split('\n').slice(-15).join('\n  '));
  }
  if (input.recentActionResults && input.recentActionResults.length > 0) {
    lines.push('');
    lines.push('RECENT ACTION RESULTS (what your previous moves actually returned):');
    for (const r of input.recentActionResults) {
      const status = r.success ? 'OK' : 'FAIL';
      const resultStr = r.error ? `error=${r.error}` : truncate(JSON.stringify(r.result), 600);
      lines.push(`  cycle ${r.cycleNumber} [${r.action}] ${status}: ${resultStr}`);
    }
  }
  lines.push('');
  lines.push('TASK: Pick exactly ONE action to take this cycle. Inaction is not an option — you must choose a verb from the list. If you have no information, use a sense (e.g. inbox_read, web_search, fs_read) to gather some. If you have nothing to act on, your job is to discover something to act on. Build on what your previous actions returned — do not repeat the same query in a tight loop unless you have a reason.');
  lines.push('Reply with ONLY a JSON object:');
  lines.push('{"action": "<action_name>", "payload": {...}, "thought": "<one short sentence>"}');
  lines.push('Allowed action names: ' + [...input.capabilities.senses, ...input.capabilities.actions].join(', '));
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…[truncated]';
}
