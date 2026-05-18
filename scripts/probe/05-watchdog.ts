// Probe #5 — runcor-watchdog
//
// Questions:
//   1. Does audit() find a finding when agent stated a problem matching an unused capability?
//      (Canonical case: agent says "I need to email" but never invoked email_send.)
//   2. Does it correctly NOT fire when the capability has been used?
//   3. Does skipValidation degrade-mode return findings without dialectic?
//   4. Are Finding objects shaped so V2 can put them in the next prompt?
//   5. V2 wiring audit: do findings flow back into the next cycle's prompt, or just memory?

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Watchdog } from 'runcor-watchdog';
import type { AuditInput, Capability, RecentAction, StatedProblem } from 'runcor-watchdog';

const CAPS: Capability[] = [
  { name: 'inbox_read', description: 'Read recent emails from inbox' },
  { name: 'email_send', description: 'Send an email from the agent\'s account' },
  { name: 'web_search', description: 'Search the web for current information' },
  { name: 'firecrawl_scrape', description: 'Scrape a URL\'s content as markdown' },
  { name: 'fs_read', description: 'Read a file from scratchpad' },
  { name: 'fs_write', description: 'Write a file to scratchpad' },
  { name: 'git_push', description: 'Commit and push a file to a GitHub repo' },
  { name: 'publish_post', description: 'Publish a blog post' },
  { name: 'github_create_repo', description: 'Create a new GitHub repo' },
];

async function main() {
  console.log('[probe-05] runcor-watchdog — pattern matchers + dialectic validation\n');
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // ── Phase 1: canonical case — stated need matching unused capability ──
  console.log('=== Phase 1: stated-need vs unused-capability matcher ===');
  const wd = new Watchdog(); // no dialectic → degraded mode
  const input1: AuditInput = {
    statedProblems: [
      { text: 'I need to email the founder about Q3 OKRs', source: 'cycle-50-reasoning' },
      { text: 'I should reach out to alex@example for the onboarding call', source: 'cycle-52-reasoning' },
    ],
    availableCapabilities: CAPS,
    recentActions: [
      { tool: 'web_search', count: 12 },
      { tool: 'fs_write', count: 8 },
      // notice: email_send never invoked despite stated need
    ],
    skipValidation: true,
  };
  const findings1 = await wd.audit(input1);
  console.log(`  findings: ${findings1.length}`);
  for (const f of findings1) {
    console.log(`    [${f.category}] capability=${f.capability} problem="${f.problem.slice(0, 60)}" conf=${f.matchConfidence.toFixed(2)} validated=${f.validated}`);
  }
  const emailFinding = findings1.find(f => f.capability === 'email_send');
  checks.push({ name: 'finds unused email_send despite stated need', pass: emailFinding !== undefined });

  // ── Phase 2: capability was actually used — should NOT flag ──
  console.log('\n=== Phase 2: stated-need with capability already used ===');
  const input2: AuditInput = {
    statedProblems: [
      { text: 'I need to email the founder about Q3 OKRs', source: 'cycle-50-reasoning' },
    ],
    availableCapabilities: CAPS,
    recentActions: [
      { tool: 'email_send', count: 3, lastUsed: 'cycle-49' },
      { tool: 'web_search', count: 12 },
    ],
    skipValidation: true,
  };
  const findings2 = await wd.audit(input2);
  console.log(`  findings: ${findings2.length}`);
  const stillFlagsEmail = findings2.find(f => f.capability === 'email_send') !== undefined;
  checks.push({ name: 'no email_send flag when used', pass: !stillFlagsEmail });

  // ── Phase 3: heavy-research-no-execution matcher (V2 forensic case) ──
  console.log('\n=== Phase 3: heavy-research-without-execution ===');
  const input3: AuditInput = {
    statedProblems: [
      { text: 'I need to figure out fundraising', source: 'cycle-100-reasoning' },
    ],
    availableCapabilities: CAPS,
    recentActions: [
      { tool: 'web_search', count: 22 },        // tons of research
      { tool: 'firecrawl_scrape', count: 8 },  // more research
      { tool: 'fs_write', count: 2 },           // minimal action
      // notice: no email_send, no publish_post, no git_push despite 30 research actions
    ],
    skipValidation: true,
  };
  const findings3 = await wd.audit(input3);
  console.log(`  findings: ${findings3.length}`);
  for (const f of findings3) {
    console.log(`    [${f.category}] cap=${f.capability} conf=${f.matchConfidence.toFixed(2)}`);
  }
  const researchLoop = findings3.find(f => f.category === 'repeated-research-without-execution');
  checks.push({ name: 'flags repeated-research-without-execution', pass: researchLoop !== undefined });

  // ── Phase 4: finding shape — can V2 inject into next prompt? ──
  console.log('\n=== Phase 4: finding shape ===');
  const sample = findings1[0];
  if (sample) {
    console.log(`  sample finding fields: ${Object.keys(sample).join(', ')}`);
    const promptable = `[watchdog] ${sample.category}: capability "${sample.capability}" is available but unused despite stated problem "${sample.problem.slice(0, 80)}". Consider invoking ${sample.capability}.`;
    console.log(`  rendered as prompt-stack instruction:`);
    console.log(`    ${promptable}`);
    checks.push({ name: 'finding renderable as prompt instruction', pass: promptable.length > 50 && promptable.includes(sample.capability) });
  } else {
    checks.push({ name: 'finding renderable as prompt instruction', pass: false, detail: 'no sample finding' });
  }

  // ── Phase 5: V2 wiring audit — does V2 push findings into next cycle's prompt? ──
  console.log('\n=== Phase 5: V2 wiring audit ===');
  const sideEffectsSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/side-effects.ts', 'utf8');
  const cycleSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/cycle.ts', 'utf8');
  const contextSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/context-builder.ts', 'utf8');
  const auditCalled = /watchdog\.audit\s*\(/.test(sideEffectsSrc);
  const findingsToMemory = /watchdog_finding/.test(sideEffectsSrc);
  // does anything in the prompt-stack path read watchdog findings as a steering signal?
  const findingsInPrompt = /watchdog/i.test(contextSrc) || /watchdog/i.test(cycleSrc);
  const watchdogLayerExists = false; // there's no WatchdogLayer in src/substrate-layers/
  console.log(`  V2 side-effects calls watchdog.audit(): ${auditCalled ? 'YES' : 'NO'}`);
  console.log(`  V2 writes findings to memory (tag: watchdog_finding): ${findingsToMemory ? 'YES' : 'NO'}`);
  console.log(`  V2 surfaces findings in cycle prompt / context-builder: ${findingsInPrompt ? 'YES' : 'NO ← steering signal lost'}`);
  console.log(`  V2 has a WatchdogLayer in prompt-stack: ${watchdogLayerExists ? 'YES' : 'NO ← no direct injection'}`);
  checks.push({ name: 'V2 calls watchdog.audit()', pass: auditCalled });
  checks.push({ name: 'V2 surfaces findings into next prompt', pass: findingsInPrompt });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'watchdog functions correctly + V2 wires it correctly' : 'see failures'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
