// Probe #14 — runcor (engine)
//
// We've used the engine indirectly throughout the other probes. Confirm the core
// APIs directly. Validates that the runtime substrate is sound.
//
// Questions:
//   1. createEngine() returns a usable Runcor instance with the expected methods?
//   2. register() + trigger() can run a minimal flow end-to-end?
//   3. Cost tracker fires events as expected?

import 'dotenv/config';
import { createEngine } from 'runcor';

async function main() {
  console.log('[probe-14] runcor — base engine + flow registry + cost\n');
  const checks: Array<{ name: string; pass: boolean }> = [];

  // Minimal mock provider
  const mockProvider = {
    name: 'mock',
    async complete(_request: unknown) {
      return {
        text: 'mock-output-text',
        model: 'mock-model',
        provider: 'mock',
        usage: { promptTokens: 10, completionTokens: 20 },
      };
    },
  };

  // ── Phase 1: construct engine ──
  console.log('=== Phase 1: createEngine + core methods ===');
  const engine = await createEngine({
    model: {
      providers: [{ provider: mockProvider as unknown as Parameters<typeof createEngine>[0]['model']['providers'][0]['provider'], costPerToken: { input: 0.000001, output: 0.000003 } }],
    },
  });
  const expectedMethods = ['register', 'trigger', 'listFlows', 'addAdapter', 'listAdapterTools', 'callAdapterTool', 'on', 'off', 'shutdown'];
  for (const m of expectedMethods) {
    const has = typeof (engine as unknown as Record<string, unknown>)[m] === 'function';
    if (!has) console.log(`  missing method: ${m}`);
    checks.push({ name: `engine has ${m}()`, pass: has });
  }

  // ── Phase 2: register + trigger a minimal flow ──
  console.log('\n=== Phase 2: register + trigger ===');
  engine.register('echo', async (ctx) => {
    return { echoed: ctx.input };
  });
  const flows = engine.listFlows();
  console.log(`  registered flows: ${flows.map(f => f.name).join(', ')}`);
  checks.push({ name: 'register stores the flow', pass: flows.some(f => f.name === 'echo') });

  const exec = await engine.trigger('echo', { idempotencyKey: 'probe-echo-1', input: 'hello world' });
  // execution may complete sync or be queued — poll briefly
  let result: unknown = exec.result;
  const start = Date.now();
  while (result == null && Date.now() - start < 3000) {
    await new Promise(r => setTimeout(r, 50));
    const re = engine.getExecution?.(exec.id) ?? exec;
    if (re.state === 'complete' || re.state === 'failed') {
      result = re.result;
      break;
    }
  }
  console.log(`  trigger result: ${JSON.stringify(result).slice(0, 100)}`);
  checks.push({ name: 'trigger executes the flow', pass: result != null });

  // ── Phase 3: cost event fires when model is invoked ──
  console.log('\n=== Phase 3: cost telemetry ===');
  let costFired = false;
  let costAmount = 0;
  engine.on('cost:request', (ev) => {
    costFired = true;
    costAmount += (ev as { cost?: number; costUsd?: number }).cost ?? (ev as { costUsd?: number }).costUsd ?? 0;
  });
  engine.register('model-call', async (ctx) => {
    return await ctx.model.complete({ prompt: 'test' });
  });
  await engine.trigger('model-call', { idempotencyKey: 'probe-model-1', input: {} });
  await new Promise(r => setTimeout(r, 500));
  console.log(`  cost:request fired: ${costFired}`);
  console.log(`  cost accumulated: ${costAmount}`);
  checks.push({ name: 'cost:request event fires on model call', pass: costFired });

  await engine.shutdown();

  // ── RESULT ──
  console.log('\n=== RESULT ===');
  let allPass = true;
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'PROBE PASS' : 'PROBE FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
