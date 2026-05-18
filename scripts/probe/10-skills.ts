// Probe #10 — runcor-skills
//
// Questions:
//   1. Does proposeSkill produce a SkillProposal from trajectory data?
//   2. Does it call the dialectic (verify via call count)?
//   3. Is confidence sensibly computed from trajectory mean score?
//   4. Does V2 actually invoke skills synthesis? At what cadence + what gate?

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Skills } from 'runcor-skills';

async function main() {
  console.log('[probe-10] runcor-skills — proposeSkill from trajectories\n');
  const checks: Array<{ name: string; pass: boolean }> = [];

  // Mock dialectic that returns a canned R++ block
  let dialecticCalls = 0;
  const mockDialectic = async (cfg: { problem: string; maxRounds?: number }) => {
    dialecticCalls++;
    void cfg;
    return {
      answer: `Here is the R++ skill spec based on the success pattern:

\`\`\`
TARGET:
  name: cycle-pattern-12
  output: "Successful inbox triage + email reply pattern"

DATA:
  inputs: inbox_message

BEHAVIOR:
  1. inbox_read with limit 10
  2. If message from founder, draft reply
  3. email_send with drafted reply
\`\`\`

REASONING: The trajectories show a consistent pattern of inbox_read → email_send with high scores.`,
    };
  };

  const skills = new Skills({ dialectic: mockDialectic });

  // ── Phase 1: proposeSkill from successful trajectories ──
  console.log('=== Phase 1: proposeSkill with mock dialectic ===');
  const proposal = await skills.proposeSkill({
    pattern: {
      name: 'cycle-pattern-12',
      description: 'inbox-triage-then-reply pattern observed',
      trajectories: [
        { action: 'inbox_read', input: { limit: 10 }, output: { count: 3 }, score: 0.85 },
        { action: 'email_send', input: { to: 'founder@runcor.ai' }, output: { ok: true }, score: 0.9 },
        { action: 'inbox_read', input: { limit: 10 }, output: { count: 2 }, score: 0.8 },
        { action: 'email_send', input: { to: 'alex@example' }, output: { ok: true }, score: 0.85 },
      ],
      context: 'CEO triages inbox then replies to high-priority messages',
    },
  });

  console.log(`  proposal.name: ${proposal.name}`);
  console.log(`  proposal.confidence: ${proposal.confidence.toFixed(3)}`);
  console.log(`  proposal.trajectoryCount: ${proposal.trajectoryCount}`);
  console.log(`  proposal.parsedCleanly: ${proposal.parsedCleanly}`);
  console.log(`  proposal.attempts: ${proposal.attempts}`);
  console.log(`  proposal.rppSource (first 200 chars):`);
  console.log(`    ${proposal.rppSource.slice(0, 200).replace(/\n/g, ' | ')}`);
  console.log(`  dialectic calls: ${dialecticCalls}`);

  checks.push({ name: 'proposeSkill returns SkillProposal', pass: typeof proposal === 'object' });
  checks.push({ name: 'rppSource is non-empty', pass: proposal.rppSource.length > 0 });
  checks.push({ name: 'confidence is in [0,1]', pass: proposal.confidence >= 0 && proposal.confidence <= 1 });
  checks.push({ name: 'dialectic was invoked', pass: dialecticCalls >= 1 });
  checks.push({ name: 'trajectoryCount matches input', pass: proposal.trajectoryCount === 4 });

  // ── Phase 2: describePattern ──
  console.log('\n=== Phase 2: describePattern ===');
  const desc = skills.describePattern({
    name: 'test-pattern',
    description: 'a test',
    context: 'unit test',
    trajectories: [
      { action: 'x', input: {}, output: {}, score: 0.5 },
      { action: 'y', input: {}, output: {}, score: 0.9 },
    ],
  });
  console.log(`  rendered:\n    ${desc.replace(/\n/g, '\n    ')}`);
  checks.push({ name: 'describePattern includes mean score', pass: desc.includes('0.70') });

  // ── Phase 3: V2 wiring audit ──
  console.log('\n=== Phase 3: V2 wiring audit ===');
  const sideEffectsSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/side-effects.ts', 'utf8');
  const callsPropose = /skills\.proposeSkill\s*\(/.test(sideEffectsSrc);
  const cadenceMatch = sideEffectsSrc.match(/SKILL_SYNTHESIZE_EVERY\s*=\s*(\d+)/);
  const cadence = cadenceMatch ? parseInt(cadenceMatch[1]!, 10) : 0;
  console.log(`  V2 side-effects calls skills.proposeSkill(): ${callsPropose ? 'YES' : 'NO'}`);
  console.log(`  Synthesis cadence: every ${cadence} cycles`);
  checks.push({ name: 'V2 calls skills.proposeSkill', pass: callsPropose });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'skills works + V2 wires it' : 'see failures'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
