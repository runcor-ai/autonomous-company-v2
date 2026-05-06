// T116 [US5] — Lint: src/agent/ contains zero `setTimeout`/`setInterval` against literal
// numbers. The cadence MUST be harness-driven via runcor-temporal.

import { describe, expect, test } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await listTsFiles(full);
      out.push(...sub);
    } else if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('T116: no fixed timers in src/agent/ (FR-020)', () => {
  test('no setTimeout(N) or setInterval(N) with literal numeric arguments', async () => {
    const files = await listTsFiles(path.resolve('src/agent'));
    const offenders: Array<{ file: string; match: string; line: number }> = [];
    const fixedTimerRe = /\b(?:setTimeout|setInterval)\s*\([^,]*,\s*(\d+)\s*[,)]/g;
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        // Skip comments + DEFAULT_SLEEP wrapper which receives a variable.
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        let match: RegExpExecArray | null;
        const re = new RegExp(fixedTimerRe);
        while ((match = re.exec(line)) !== null) {
          offenders.push({ file: path.relative(process.cwd(), file), match: match[0], line: i + 1 });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
