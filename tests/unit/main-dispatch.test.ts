// T113 [US4] — Verify src/main.ts dispatches `agent` / `control` / `dashboard` roles.

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('T113: main.ts process role dispatcher', () => {
  test('imports runAgent and runControl', async () => {
    const src = await readFile(path.resolve('src/main.ts'), 'utf8');
    expect(src).toMatch(/import .*runAgent.* from .*agent\/index/);
    expect(src).toMatch(/import .*runControl.* from .*control\/index/);
  });

  test('dispatches role argument to runAgent / runControl', async () => {
    const src = await readFile(path.resolve('src/main.ts'), 'utf8');
    expect(src).toMatch(/role === ['"]agent['"]/);
    expect(src).toMatch(/role === ['"]control['"]/);
    expect(src).toMatch(/runAgent\(\)/);
    expect(src).toMatch(/runControl\(\)/);
  });

  test('exits non-zero on unknown role', async () => {
    const src = await readFile(path.resolve('src/main.ts'), 'utf8');
    expect(src).toMatch(/process\.exit\(2\)/);
    expect(src).toMatch(/unknown role/);
  });
});
