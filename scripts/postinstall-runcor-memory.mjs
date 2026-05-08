#!/usr/bin/env node
// Postinstall: ensure runcor-memory is resolvable from runcor-data's import context.
//
// Background: runcor-data's package.json declares `"runcor-memory":
// "github:runcor-ai/runcor-memory"` as a runtime dep. V2 consumes runcor-data via
// `file:../runcor-data`, which npm represents as a SYMLINK in node_modules/runcor-data.
// runcor-data's nested deps live in the symlinked source's own node_modules — populated
// by `npm install` in the source repo, NOT by V2's `npm install`. On Railway, only V2's
// repo is checked out + npm-installed, so runcor-data's source repo doesn't exist and its
// nested node_modules is empty. `await import('runcor-memory')` from
// runcor-data/dist/pipeline.js fails with "Cannot find package" — observed live
// 2026-05-08 cycles 68/70 even after the npm `overrides` field was added.
//
// This script runs as a V2 postinstall hook. It checks whether runcor-memory is reachable
// from runcor-data's nested context; if not, copies runcor-memory's compiled output from
// V2's top-level node_modules/runcor-memory into node_modules/runcor-data/node_modules/.
// Symlinks would be cleaner but Railway's container fs may not honor cross-package symlinks;
// copy is the more portable choice.

import { existsSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const srcDir = path.join(repoRoot, 'node_modules', 'runcor-memory');
const targetDir = path.join(repoRoot, 'node_modules', 'runcor-data', 'node_modules', 'runcor-memory');

if (!existsSync(srcDir)) {
  console.warn(`[postinstall] runcor-memory source not found at ${srcDir} — skipping nested copy.`);
  process.exit(0);
}

if (existsSync(targetDir)) {
  console.log(`[postinstall] runcor-memory already nested under runcor-data — skipping.`);
  process.exit(0);
}

try {
  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(srcDir, targetDir, { recursive: true });
  console.log(`[postinstall] copied runcor-memory → ${targetDir}`);
} catch (err) {
  // Don't fail the install if copy fails (e.g., readonly fs in some CI). Surface a warning;
  // runtime failure will still be diagnosable via the side_effect_error log we added in
  // commit 19c9280.
  console.warn(`[postinstall] copy failed: ${err instanceof Error ? err.message : String(err)}`);
}
