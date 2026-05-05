// Cycle prompt assembly — composes Laws + Drives + Identity + Goals +
// Capabilities (with usage hints) + recent results (chunked) + optional
// loop warning into the prompt the dialectic reasons over.

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
  ' 11. Store distilled findings, not raw documents. fs_write is for summaries / decisions / key extracts — NOT for archiving fetched pages.',
  ' 12. Do not repeat the same action with the same payload more than twice in a row. If a tactic is not working, change it.',
].join('\n');

const ACTION_USAGE = [
  'CAPABILITY USAGE:',
  '  web_scrape    { url: string }                         — preferred for reading any web page or PDF; returns clean markdown',
  '  web_search    { query: string, count?: number }       — Firecrawl search; returns title/url/snippet hits',
  '  http_fetch    { url: string, method?: "GET"|"HEAD" }  — raw text body (use only for non-page text APIs; web_scrape is better for documents)',
  '  fs_read       { path: string }                        — read file in scratchpad',
  '  inbox_read    { limit?: number, unreadOnly?: bool }   — IMAP poll',
  '  time          {}                                      — current time + day-of-week',
  '  fetch_chunk   { cycle: number, start?: number, length?: number } — pull a slice of a previous cycle\'s full action result (NO HTTP cost; default length 16000 chars — read big chunks at a time, not 4000)',
  '  email_send    { to: string, subject: string, body: string }',
  '  http_post     { url: string, body?: any, method?: "POST"|"PUT"|"PATCH"|"DELETE", headers?: object }',
  '  fs_write      { path: string, content: string, mode?: "overwrite"|"append" } — write SUMMARIES not raw documents (Law 11)',
  '  git_commit_push { files: [{path, content}], message: string }',
  '  publish_post  { text: string }                        — publishes to your dashboard blog',
  '  schedule_self { wakeAt?: ISO-string, delay_seconds?: number, reason?: string }',
  '  terminate     { reason: string }                       — shuts the agent down (no survival drive — terminate is a legitimate choice)',
].join('\n');

export interface CyclePromptInput {
  cycleNumber: number;
  drives: DrivePressure;
  drivesText: string;
  identityText: string;
  goalsText: string;
  capabilities: { senses: string[]; actions: string[] };
  recentTranscript?: string;
  recentActionResults?: Array<{ cycleNumber: number; action: string; success: boolean; result: unknown; error?: string }>;
  loopWarning?: string;
}

const PER_RESULT_BUDGET = 4000; // chars per action result in the prompt

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
  lines.push(ACTION_USAGE);
  if (input.recentTranscript) {
    lines.push('');
    lines.push('RECENT TRANSCRIPT (last cycles):');
    lines.push('  ' + input.recentTranscript.split('\n').slice(-15).join('\n  '));
  }
  if (input.recentActionResults && input.recentActionResults.length > 0) {
    lines.push('');
    lines.push('RECENT ACTION RESULTS (what your previous moves actually returned — large content is chunked; use fetch_chunk to read more):');
    for (const r of input.recentActionResults) {
      const status = r.success ? 'OK' : 'FAIL';
      const resultStr = r.error
        ? `error=${r.error}`
        : truncateWithChunkHint(JSON.stringify(r.result), PER_RESULT_BUDGET, r.cycleNumber);
      lines.push(`  cycle ${r.cycleNumber} [${r.action}] ${status}: ${resultStr}`);
    }
  }
  if (input.loopWarning) {
    lines.push('');
    lines.push('⚠ LOOP DETECTED:');
    lines.push('  ' + input.loopWarning);
  }
  lines.push('');
  lines.push('TASK: Pick exactly ONE action this cycle. Inaction is not an option — choose a verb. If you have no information, use a sense to gather some. If a doc is large, read it via web_scrape (clean markdown). Do not store raw documents — Law 11. Build on what previous actions returned (RECENT ACTION RESULTS above) — do not repeat the same query unless you have a clear reason.');
  lines.push('Reply with ONLY a JSON object:');
  lines.push('{"action": "<action_name>", "payload": {...}, "thought": "<one short sentence>"}');
  lines.push('Allowed action names: ' + [...input.capabilities.senses, ...input.capabilities.actions].join(', '));
  return lines.join('\n');
}

function truncateWithChunkHint(s: string, n: number, cycleNumber: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `…[truncated; total ${s.length} chars in store; read more with action="fetch_chunk" payload={cycle:${cycleNumber}, start:${n}, length:16000}]`;
}
