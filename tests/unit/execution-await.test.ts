// Locks the contract: cycle.ts MUST await engine execution completion before reading
// exec.result. Bug observed live 2026-05-08 fresh-reset run — every cycle's actionInvoked
// was null even though the model produced valid {action: ...} responses, because
// engine.trigger() dispatches asynchronously and returns immediately with result=null.
// The fix is to wait for the engine's `execution:complete` event matching the trigger's
// execution.id. This test pins the wait, so a future commit can't silently regress.

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CYCLE_PATH = path.resolve('src/agent/cycle.ts');

let src: string;
async function load(): Promise<string> {
  if (!src) src = await readFile(CYCLE_PATH, 'utf8');
  return src;
}

describe('cycle.ts must await execution completion', () => {
  test('declares waitForExecutionComplete helper', async () => {
    const s = await load();
    expect(s).toMatch(/function waitForExecutionComplete\(/);
  });

  test('waitForExecutionComplete subscribes to execution:complete event', async () => {
    const s = await load();
    expect(s).toMatch(/engine\.on\(['"]execution:complete['"]/);
    expect(s).toMatch(/engine\.off\(['"]execution:complete['"]/);
  });

  test('waitForExecutionComplete filters by executionId', async () => {
    const s = await load();
    expect(s).toMatch(/payload\.executionId\s*!==?\s*executionId/);
  });

  test('waitForExecutionComplete has a finite timeout', async () => {
    const s = await load();
    expect(s).toMatch(/EXECUTION_COMPLETE_TIMEOUT_MS\s*=\s*\d/);
    expect(s).toMatch(/setTimeout\(/);
    expect(s).toMatch(/clearTimeout\(/);
  });

  test('cycle loop consumes the wait result, not exec.result directly', async () => {
    const s = await load();
    // The trigger return is named `exec`. Before reading text/usage, code must check
    // `exec.state` OR call waitForExecutionComplete. Allowing both shapes (the early-exit
    // for already-complete executions is fine).
    expect(s).toMatch(/await waitForExecutionComplete\(args\.engine, exec\.id\)/);
    // The pre-bug pattern was: const result = exec.result as { text?: string ... }
    // Locking against its return: only the early-exit branch may read exec.result, and
    // only when state is already terminal.
    expect(s).toMatch(/exec\.state === ['"]complete['"]\s*\|\|\s*exec\.state === ['"]failed['"]/);
  });

  test('wait result returns failed state when handler errored', async () => {
    const s = await load();
    // Pin the failed-state handling: cycle should set status = 'cycle_failed_call' on a
    // failed completion, not silently treat empty result as a parse miss.
    expect(s).toMatch(/completion\.state === ['"]failed['"]/);
    expect(s).toMatch(/status\s*=\s*['"]cycle_failed_call['"]/);
  });
});
