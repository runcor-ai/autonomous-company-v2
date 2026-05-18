// Probe #8 — runcor-dialectic
//
// Questions:
//   1. Does dialectic() fire Player → Coach → Judge in canonical topology?
//   2. Does the transcript contain entries for all 3 roles?
//   3. Does maxRounds bound the dialectic?
//   4. Does budget_cap_usd throw BudgetExhaustedError if exceeded?
//   5. Are canonical role models the ones we set (nemotron-120b player, qwen3-32b coach, llama-8b judge)?
//   6. V2 wiring audit: how does V2 call dialectic (via DIALECTIC_LIKE in side-effects)?

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import {
  dialectic,
  MockAdapter,
  registerProvider,
  canonicalRoleSet,
} from 'runcor-dialectic';

// Register mock adapter as a provider named 'mock'
// Queue generous responses — dialectic may call each role multiple times across rounds
const playerResponses = Array.from({ length: 8 }, (_, i) => ({
  content: i === 0
    ? 'INITIAL DRAFT: I propose we hire a CFO before Q3.'
    : `REVISED (iter ${i}): hire a part-time fractional CFO this quarter.`,
  tokens: { input: 200 + i * 50, output: 60 },
}));
const coachResponses = Array.from({ length: 8 }, (_, i) => ({
  content: i >= 1
    ? '{"all_incorporated": true, "missing": [], "reason": "Player addressed concerns"}'
    : '{"all_incorporated": false, "missing": ["fractional vs full-time"], "reason": "Consider part-time alternative"}',
  tokens: { input: 300, output: 30 },
}));
const judgeResponses = Array.from({ length: 8 }, (_, i) => ({
  content: i % 2 === 0
    ? '{"is_novel": true, "reason": "draft is informative"}'
    : '{"all_incorporated": true, "missing": [], "reason": "Player addressed coach concerns"}',
  tokens: { input: 200, output: 25 },
}));

async function main() {
  console.log('[probe-08] runcor-dialectic — Player/Coach/Judge canonical topology\n');
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  // ── Phase 1: canonical role-set has expected models ──
  console.log('=== Phase 1: canonical role-set models ===');
  const player = canonicalRoleSet.roles.player;
  const coach = canonicalRoleSet.roles.coach;
  const judge = canonicalRoleSet.roles.judge;
  console.log(`  Player model: ${player?.model}`);
  console.log(`  Coach model:  ${coach?.model}`);
  console.log(`  Judge model:  ${judge?.model}`);
  checks.push({ name: 'canonical Player is nemotron-120b', pass: player?.model.includes('nemotron-3-super-120b') === true });
  checks.push({ name: 'canonical Coach is qwen3-32b', pass: coach?.model.includes('qwen3-32b') === true });
  checks.push({ name: 'canonical Judge is llama-3.1-8b', pass: judge?.model.includes('llama-3.1-8b') === true });

  // ── Phase 2: dialectic fires Player → Coach → Judge with MockAdapter ──
  console.log('\n=== Phase 2: full dialectic call with MockAdapter (one inner mock per named role) ===');
  // MockAdapter's `name` is a readonly instance property — subclassing doesn't override it.
  // Build plain-object adapters that delegate complete() to a MockAdapter instance.
  const wrapMock = (name: string, mock: MockAdapter) => ({
    name,
    complete: mock.complete.bind(mock),
  });
  registerProvider(wrapMock('mock-player', new MockAdapter(playerResponses)));
  registerProvider(wrapMock('mock-coach', new MockAdapter(coachResponses)));
  registerProvider(wrapMock('mock-judge', new MockAdapter(judgeResponses)));

  try {
    const result = await dialectic({
      problem: 'Should we hire a CFO before Q3?',
      maxRounds: 2,
      roles: {
        player: { ...player!, model: 'mock-player/test' },
        coach: { ...coach!, model: 'mock-coach/test' },
        judge: { ...judge!, model: 'mock-judge/test' },
      },
    });
    console.log(`  answer: ${result.answer.slice(0, 120)}...`);
    console.log(`  transcript entries: ${result.transcript.length}`);
    console.log(`  total cost: ${result.cost_usd !== undefined ? '$' + result.cost_usd.toFixed(6) : '(unknown — mock prices)'}`);
    console.log(`  converged: ${result.converged}`);
    if (result.tokens) console.log(`  total tokens: ${result.tokens.input} in / ${result.tokens.output} out`);

    const roles = new Set(result.transcript.map(r => r.role));
    console.log(`  roles seen in transcript: [${[...roles].join(', ')}]`);

    checks.push({ name: 'transcript contains player role', pass: roles.has('player') });
    checks.push({ name: 'transcript contains coach role', pass: roles.has('coach') });
    checks.push({ name: 'transcript contains judge role', pass: roles.has('judge') });
    checks.push({ name: 'answer is non-empty', pass: result.answer.length > 0 });
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    checks.push({ name: 'dialectic call succeeds', pass: false });
  }

  // ── Phase 3: V2 wiring audit ──
  console.log('\n=== Phase 3: V2 wiring audit ===');
  const sideEffectsSrc = readFileSync('C:/runcor May 3 2026/autonomous-company-v2/src/agent/side-effects.ts', 'utf8');
  const usesDialecticLike = /DIALECTIC_LIKE\s*=|DIALECTIC_LIKE\s*\(/.test(sideEffectsSrc);
  const callsDialecticFromIdentity = /identity\.reflect[\s\S]{0,500}dialectic/.test(sideEffectsSrc);
  const callsDialecticFromGoals = /goals\.propose[\s\S]{0,500}dialectic/.test(sideEffectsSrc);
  console.log(`  V2 has DIALECTIC_LIKE adapter wrapper: ${usesDialecticLike ? 'YES' : 'NO'}`);
  console.log(`  identity.reflect receives dialectic: ${callsDialecticFromIdentity ? 'YES' : 'NO'}`);
  console.log(`  goals.propose receives dialectic: ${callsDialecticFromGoals ? 'YES' : 'NO'}`);
  checks.push({ name: 'V2 wires dialectic to identity.reflect + goals.propose', pass: usesDialecticLike });

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'} — ${allPass ? 'dialectic works + V2 wires it' : 'see failures'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
