// Minimal repro: call runcor-dialectic exactly the way V2's boot does, with the canonical
// role-set, and observe whether OpenRouter receives the model string with the openrouter/
// prefix stripped or not.

import 'dotenv/config';
import { dialectic } from 'runcor-dialectic';
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const dialecticPkg = nodeRequire('runcor-dialectic') as {
  providerRegistry?: {
    parseModel(m: string): { provider: string; model: string };
    adapters: Map<string, unknown>;
  };
};

async function main() {
  const registry = dialecticPkg.providerRegistry;
  console.log('=== Registry state ===');
  console.log(`  providerRegistry exported on package? ${registry ? 'yes' : 'NO'}`);
  if (registry) {
    const testCases = [
      'openrouter/meta-llama/llama-3.1-8b-instruct',
      'openrouter/nvidia/nemotron-3-super-120b-a12b',
      'openrouter/qwen/qwen3-32b',
      'meta-llama/llama-3.1-8b-instruct',
      'anthropic/claude-haiku-4-5',
    ];
    for (const m of testCases) {
      const parsed = registry.parseModel(m);
      console.log(`  parseModel("${m}") => ${JSON.stringify(parsed)}`);
    }
    console.log(`\n  registered adapter names: [${[...registry.adapters.keys()].join(', ')}]`);
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY required to test live call'); process.exit(2);
  }
  console.log('\n=== Live dialectic call (canonical role-set) ===');
  try {
    const result = await dialectic({
      problem: 'Propose 2 goals for an agent that just wrote files and read inbox messages. Be brief.',
      maxRounds: 3,
    });
    console.log(`SUCCESS — answer: "${result.answer.slice(0, 100)}"`);
    console.log(`  rounds: ${result.rounds}, cost: ${result.cost_usd ?? '(unknown)'}, events: ${result.events?.length ?? 0}`);
    if (result.events) {
      // Count Judge invocations specifically
      const judgeEvents = result.events.filter((e: any) => e.type === 'judge_call' || e.type === 'novelty_check' || e.type === 'incorporation_check' || (e.role === 'judge'));
      console.log(`  Judge invocations: ${judgeEvents.length}`);
      for (const ev of result.events.slice(0, 10)) {
        console.log(`    ${(ev as any).type ?? '?'}: ${JSON.stringify(ev).slice(0, 150)}`);
      }
    }
  } catch (e) {
    console.log(`FAIL — ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.log('  stack first lines:\n    ' + e.stack.split('\n').slice(0,4).join('\n    '));
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
