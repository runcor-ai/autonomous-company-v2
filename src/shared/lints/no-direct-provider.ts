// T045 — Lint guard: no direct model-provider imports outside the engine package (FR-010).
//
// Walks src/ recursively (excluding the engine factory + scripts) and fails CI if any V2
// source file imports a model-provider SDK directly. Every model call MUST route through
// `runcor.modelRouter` so the substrate gate fires unconditionally (Principle V). This guard
// makes the constitutional rule mechanically enforceable.
//
// Forbidden patterns (in V2 source, outside the engine factory):
//   - import from '@anthropic-ai/sdk', 'openai', 'openrouter' (direct SDK)
//   - fetch / https.get / axios call to api.openai.com, api.anthropic.com, openrouter.ai
//
// Permitted callers: src/engine/*.ts (the engine factory creates the provider registration).
// Tests are also permitted to import provider SDKs (mocks).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"]@anthropic-ai\/sdk['"]/,
  /from\s+['"]openai['"]/,
  /from\s+['"]openrouter['"]/,
];

const FORBIDDEN_URL_PATTERNS = [
  /api\.openai\.com/,
  /api\.anthropic\.com/,
  /openrouter\.ai\/api/,
];

const PERMITTED_DIRS = [
  'src/engine', // engine factory legitimately wraps provider registration
  'tests', // tests may mock provider SDKs
  'src/shared/lints', // this file documents the patterns
];

const SRC_DIRS_TO_SCAN = ['src'];

interface Hit {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

function isPermittedPath(relPath: string): boolean {
  // Normalize separators for cross-platform comparison.
  const normalized = relPath.replace(/\\/g, '/');
  return PERMITTED_DIRS.some((dir) => normalized.startsWith(dir + '/') || normalized === dir);
}

function* walkTsFiles(dir: string, root: string): Generator<string> {
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
      yield* walkTsFiles(full, root);
    } else if (st.isFile() && extname(entry) === '.ts') {
      yield full;
    }
  }
}

export function scanForDirectProviderImports(repoRoot: string): Hit[] {
  const hits: Hit[] = [];
  for (const baseDir of SRC_DIRS_TO_SCAN) {
    const absBase = join(repoRoot, baseDir);
    for (const file of walkTsFiles(absBase, repoRoot)) {
      const rel = relative(repoRoot, file).split(sep).join('/');
      if (isPermittedPath(rel)) continue;

      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            hits.push({ file: rel, line: idx + 1, text: line.trim(), pattern: pattern.source });
          }
        }
        for (const pattern of FORBIDDEN_URL_PATTERNS) {
          if (pattern.test(line)) {
            hits.push({ file: rel, line: idx + 1, text: line.trim(), pattern: pattern.source });
          }
        }
      });
    }
  }
  return hits;
}

export function reportHits(hits: Hit[]): void {
  if (hits.length === 0) {
    console.log('[lint:no-direct-provider] OK — no direct model-provider imports found in src/');
    return;
  }
  console.error(`[lint:no-direct-provider] FAIL — ${hits.length} forbidden ${hits.length === 1 ? 'import' : 'imports'} found:`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  matches /${hit.pattern}/`);
    console.error(`    ${hit.text}`);
  }
  console.error(
    '\nFR-010 (Principle V): every LLM call MUST route through runcor.modelRouter.\n' +
      'Permitted callers: src/engine/* (engine factory), tests/* (mocks).\n' +
      'Move the import inside the engine factory or replace with engine.trigger() / engine.modelRouter.complete().',
  );
}
