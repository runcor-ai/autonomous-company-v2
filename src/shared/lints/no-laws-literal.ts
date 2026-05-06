// T165 — Lint guard: no LAWS array literal or hand-rolled cycle prompt (FR-015).
//
// V2's cycle prompt MUST be assembled by `runcor-substrate.PromptStack` from registered layers;
// no V2 source file may contain a literal LAWS array, a hardcoded "TASK:" footer, or any
// cycle-prompt template string. This is the construction-time guarantee that V2 doesn't
// silently bypass the substrate gate by hand-rolling its own prompt.
//
// Permitted callers: tests/* (test fixtures may construct synthetic prompts).
//
// Forbidden patterns:
//   - `const LAWS = [` / `const LAWS: ... = [` / `LAWS = [` (a literal Laws array)
//   - `"TASK:"` / "'TASK:'" — the 001 hand-rolled cycle-prompt footer
//   - Cycle-prompt template literals containing both "Laws" and a "TASK" / "USER" footer
//     (heuristic — we look for the literal string "TASK:" inside a multi-line template)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\bconst\s+LAWS\s*(:\s*[^=]+)?=\s*\[/,
    description: 'literal LAWS array (use runcor-substrate.LawsLayer or substrate.laws instead)',
  },
  {
    pattern: /\bLAWS\s*=\s*\[\s*['"]/,
    description: 'literal LAWS array assignment',
  },
  {
    pattern: /['"]TASK:\s*['"]/,
    description: '001-style hand-rolled cycle-prompt footer ("TASK:")',
  },
  {
    pattern: /\bassembleCyclePrompt\b/,
    description: '001-style hand-rolled cycle-prompt assembler (use substrate.promptStack.assemble instead)',
  },
];

const PERMITTED_DIRS = [
  'tests', // tests may mock prompts
  'src/shared/lints', // this file documents the patterns
];

const SRC_DIRS_TO_SCAN = ['src'];

interface Hit {
  file: string;
  line: number;
  text: string;
  description: string;
}

function isPermittedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return PERMITTED_DIRS.some((dir) => normalized.startsWith(dir + '/') || normalized === dir);
}

function* walkTsFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkTsFiles(full);
    } else if (st.isFile() && extname(entry) === '.ts') {
      yield full;
    }
  }
}

export function scanForLawsLiteral(repoRoot: string): Hit[] {
  const hits: Hit[] = [];
  for (const baseDir of SRC_DIRS_TO_SCAN) {
    const absBase = join(repoRoot, baseDir);
    for (const file of walkTsFiles(absBase)) {
      const rel = relative(repoRoot, file).split(sep).join('/');
      if (isPermittedPath(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const { pattern, description } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            hits.push({ file: rel, line: idx + 1, text: line.trim(), description });
          }
        }
      });
    }
  }
  return hits;
}

export function reportHits(hits: Hit[]): void {
  if (hits.length === 0) {
    console.log('[lint:no-laws-literal] OK — no hand-rolled prompt assembly in src/');
    return;
  }
  console.error(`[lint:no-laws-literal] FAIL — ${hits.length} forbidden ${hits.length === 1 ? 'occurrence' : 'occurrences'} found:`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.description}`);
    console.error(`    ${hit.text}`);
  }
  console.error(
    '\nFR-015 (Principle V): cycle prompt MUST be assembled by substrate.promptStack from registered layers.\n' +
      'Use runcor-substrate.PromptStack + LawsLayer / RealityLayer / DrivesLayer / GoalsLayer / IdentityLayer / CapabilitiesLayer / MemoryRecallLayer.\n' +
      'Permitted callers: tests/* (mocks).',
  );
}
