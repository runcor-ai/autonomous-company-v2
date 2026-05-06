// T085 [US1] — Boot guard fails closed when any of the 14 components is missing/broken.
//
// We don't actually delete sibling packages from package.json (that would break the rest of
// the test suite). Instead we exercise the resolution-check + installer-engagement code paths
// directly with table-driven inputs.

import { describe, expect, test } from 'vitest';
import { CANONICAL_COMPONENTS, CANONICAL_COMPONENT_COUNT } from '../../src/boot/components.js';
import { assertInstallerEngaged, InstallerNotEngagedError } from '../../src/boot/installer-check.js';

describe('CANONICAL_COMPONENTS', () => {
  test('contains exactly 14 names (FR-011)', () => {
    expect(CANONICAL_COMPONENT_COUNT).toBe(14);
    expect(CANONICAL_COMPONENTS).toHaveLength(14);
  });

  test('lists all 14 spec-mandated component names', () => {
    expect(CANONICAL_COMPONENTS).toEqual([
      'runcor',
      'runcor-substrate',
      'runcor-memory',
      'runcor-data',
      'runcor-integration',
      'runcor-dialectic',
      'runcor-meta',
      'runcor-watchdog',
      'runcor-skills',
      'runcor-drives',
      'runcor-identity',
      'runcor-goals',
      'runcor-temporal',
      'runcor-coherence',
    ]);
  });

  test('all 14 components resolve as file: deps (V2 install integrity)', async () => {
    // Some sibling packages restrict `exports` to specific subpaths and reject
    // `./package.json`. Verify resolution via the npm-installed file-tree directly.
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    for (const name of CANONICAL_COMPONENTS) {
      const pjson = path.resolve('node_modules', name, 'package.json');
      const raw = await readFile(pjson, 'utf8');
      const meta = JSON.parse(raw) as { name?: string; version?: string };
      expect(meta.name).toBe(name);
      expect(meta.version).toBeTruthy();
    }
  });
});

describe('assertInstallerEngaged (T086, FR-012)', () => {
  test('throws when modelRouter is undefined', () => {
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof assertInstallerEngaged>[0]['installer'];
    expect(() => assertInstallerEngaged({ installer, engine: {} })).toThrow(InstallerNotEngagedError);
  });

  test('throws when modelRouter.complete is not a function', () => {
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof assertInstallerEngaged>[0]['installer'];
    expect(() =>
      assertInstallerEngaged({ installer, engine: { modelRouter: { complete: 'not-a-function' as unknown } } }),
    ).toThrow(InstallerNotEngagedError);
  });

  test('throws when isInstalled() returns false', () => {
    const installer = { isInstalled: () => false } as unknown as Parameters<typeof assertInstallerEngaged>[0]['installer'];
    const fn = () => undefined;
    expect(() =>
      assertInstallerEngaged({ installer, engine: { modelRouter: { complete: fn } } }),
    ).toThrow(/isInstalled.*returned false/);
  });

  test('throws when patched method is not branded with the installed-marker symbol', () => {
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof assertInstallerEngaged>[0]['installer'];
    const fn = () => undefined; // not branded
    expect(() =>
      assertInstallerEngaged({ installer, engine: { modelRouter: { complete: fn } } }),
    ).toThrow(/not branded/);
  });

  test('passes when isInstalled returns true AND method has the installed-marker brand', () => {
    const installer = { isInstalled: () => true } as unknown as Parameters<typeof assertInstallerEngaged>[0]['installer'];
    const fn = () => undefined;
    Object.defineProperty(fn, Symbol.for('runcor-substrate/installed'), { value: true });
    expect(() =>
      assertInstallerEngaged({ installer, engine: { modelRouter: { complete: fn } } }),
    ).not.toThrow();
  });
});
