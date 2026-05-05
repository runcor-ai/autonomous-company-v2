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
  lines.push('');
  lines.push('TASK: Decide what to attend to and what action (if any) to take this cycle.');
  lines.push('Reply with ONLY a JSON object:');
  lines.push('{"action": "<action_name|none>", "payload": {...}, "thought": "<one short sentence>"}');
  lines.push('Allowed action names: ' + ['none', ...input.capabilities.senses, ...input.capabilities.actions].join(', '));
  return lines.join('\n');
}
