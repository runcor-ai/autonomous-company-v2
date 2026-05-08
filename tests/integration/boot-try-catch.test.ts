// T088 [US1] — Verify boot.ts handles each of the 14 components' construction in a try/catch
// that names the failing component, AND that no model call fires before all init succeeds.
// This is a source-level invariant check (the boot guard that silently swallows errors was the
// root failure mode of 001 per CLAUDE.md §3).

import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CANONICAL_COMPONENTS } from '../../src/boot/components.js';

const BOOT_PATH = path.resolve('src/boot/boot.ts');

let bootSource: string;
async function getBoot(): Promise<string> {
  if (!bootSource) bootSource = await readFile(BOOT_PATH, 'utf8');
  return bootSource;
}

describe('T088: boot.ts try/catch covers every component (FR-011)', () => {
  test('every BootError throw names a component string', async () => {
    const src = await getBoot();
    // Each construction site is wrapped in `try { ... } catch (err) { ... throw new BootError('<name>', ...) }`.
    // We assert that for each canonical component (excluding stateless ones we only resolve, not
    // construct: dialectic / drives / meta / skills are functions, not constructed in try/catch),
    // boot.ts contains a BootError invocation naming it OR a component-resolution check
    // (verifyComponentResolution) covers it.
    const resolutionGuardPresent = /verifyComponentResolution\(\)/.test(src);
    expect(resolutionGuardPresent).toBe(true);

    const constructedComponents = new Set([
      'runcor',
      'runcor-substrate',
      'runcor-memory',
      'runcor-data',
      'runcor-integration',
      'runcor-temporal',
      'runcor-identity',
      'runcor-goals',
      'runcor-coherence',
      'runcor-watchdog',
      'runcor-skills',
    ]);

    for (const comp of constructedComponents) {
      const matcher = new RegExp(`new BootError\\(['\\\`]${comp}['\\\`]`);
      expect(matcher.test(src), `boot.ts must throw BootError for ${comp}`).toBe(true);
    }
  });

  test('no LLM call fires before substrate.installer.install() completes', async () => {
    const src = await getBoot();
    // Verify boot does NOT trigger flows or call adapter tools at boot time.
    // The cycle loop in agent/index.ts is what fires LLM calls — boot itself must not.
    expect(src).not.toMatch(/engine\.trigger\(/);
    expect(src).not.toMatch(/engine\.callAdapterTool\(/);
    // boot.ts MAY define a `componentModel` closure that wraps modelRouter.complete (passed
    // to runcor-data + runcor-integration as their ModelComplete adapter). That closure is
    // invoked later — during cycles by data-cube ingest + schema discovery — not at boot.
    // We assert that the ONLY reference to modelRouter.complete is inside the
    // componentModel definition (which is a const-bound async closure). Any future addition
    // of a top-level call would also need to add the marker comment, which makes review
    // load-bearing.
    const modelRouterRefs = (src.match(/modelRouter\.complete/g) ?? []).length;
    if (modelRouterRefs > 0) {
      // All references must appear within the componentModel block. Locate it by its
      // declaration; walk the brace nesting to find the true outer `};` (so nested object
      // literals inside the closure body don't terminate the block prematurely).
      const blockStart = src.indexOf('const componentModel = {');
      expect(blockStart).toBeGreaterThan(0);
      let depth = 0;
      let blockEnd = -1;
      for (let i = blockStart + 'const componentModel = '.length; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) {
            blockEnd = i + 1;
            break;
          }
        }
      }
      expect(blockEnd).toBeGreaterThan(blockStart);
      const block = src.slice(blockStart, blockEnd);
      const refsInBlock = (block.match(/modelRouter\.complete/g) ?? []).length;
      expect(refsInBlock).toBe(modelRouterRefs);
    }
    // assertInstallerEngaged is the cheap engagement check (research.md §R4 v0.1 pragmatic).
    expect(src).toMatch(/assertInstallerEngaged\(/);
  });

  test('CANONICAL_COMPONENTS list is referenced for resolution check', async () => {
    const src = await getBoot();
    expect(src).toMatch(/CANONICAL_COMPONENTS/);
    // The 14 components MUST all be checked — verify the resolution loop is over the list.
    expect(src).toMatch(/for \(const name of CANONICAL_COMPONENTS\)/);
  });

  test('CANONICAL_COMPONENTS has all 14 spec-mandated names', () => {
    expect(CANONICAL_COMPONENTS).toHaveLength(14);
  });
});

describe('T089: installer-check.ts wired into boot (FR-012)', () => {
  test('boot imports assertInstallerEngaged', async () => {
    const src = await getBoot();
    expect(src).toMatch(/import .*assertInstallerEngaged.* from .*installer-check/);
  });

  test('boot calls assertInstallerEngaged after installer.install()', async () => {
    const src = await getBoot();
    const installIdx = src.indexOf('installer.install(');
    const assertIdx = src.indexOf('assertInstallerEngaged(');
    expect(installIdx).toBeGreaterThan(0);
    expect(assertIdx).toBeGreaterThan(0);
    expect(assertIdx).toBeGreaterThan(installIdx);
  });

  test('installer-check uses Symbol.for("runcor-substrate/installed")', async () => {
    const installerCheckSrc = await readFile(
      path.resolve('src/boot/installer-check.ts'),
      'utf8',
    );
    expect(installerCheckSrc).toMatch(/Symbol\.for\(['"]runcor-substrate\/installed['"]\)/);
  });
});
