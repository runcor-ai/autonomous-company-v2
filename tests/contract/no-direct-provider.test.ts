// T090 [US2] — Verifies no V2 source file imports a model-provider SDK directly outside the
// engine factory (FR-010 enforcement). Runs the existing lint guard at src/shared/lints.

import { describe, expect, test } from 'vitest';
import { execSync } from 'node:child_process';

describe('T090: no direct provider imports outside engine factory (FR-010)', () => {
  test('lint check passes', () => {
    let output = '';
    let exitCode = 0;
    try {
      output = execSync('npx tsx src/shared/lints/check.ts', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = e.status ?? 1;
      output = (e.stdout ?? '') + (e.stderr ?? '');
    }
    if (exitCode !== 0) {
      console.error('Lint output:', output);
    }
    expect(exitCode).toBe(0);
  });
});
