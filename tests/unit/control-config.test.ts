// T109 [US4] — Control config freeze (FR-102 hash, FR-103 modify→restart).
//
// Tests load + canonical-hash logic in src/control/config.ts.

import { describe, expect, test } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadControlConfig, hashControlConfig, type ControlConfig } from '../../src/control/config.js';

const VALID_CONFIG = {
  model: 'openrouter/test',
  playerSystemPrompt: 'You are a test agent.',
  cadenceMs: 300_000,
  budgetUsd: 100,
  actionSurface: ['web_search', 'fs_read'],
  memoryDb: 'control-memory.db',
  dataDb: 'control-data.db',
};

async function writeTempConfig(content: object): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'v2-control-config-'));
  const file = path.join(dir, 'control-config.json');
  await writeFile(file, JSON.stringify(content), 'utf8');
  return file;
}

describe('loadControlConfig', () => {
  test('loads + hashes a valid config', async () => {
    const file = await writeTempConfig(VALID_CONFIG);
    const loaded = await loadControlConfig(file);
    expect(loaded.config.model).toBe(VALID_CONFIG.model);
    expect(typeof loaded.hash).toBe('string');
    expect(loaded.hash).toHaveLength(64); // sha256 hex
  });

  test('hashing is canonical (same content → same hash regardless of key order)', async () => {
    const a = await writeTempConfig(VALID_CONFIG);
    const reordered = {
      dataDb: VALID_CONFIG.dataDb,
      memoryDb: VALID_CONFIG.memoryDb,
      actionSurface: VALID_CONFIG.actionSurface,
      budgetUsd: VALID_CONFIG.budgetUsd,
      cadenceMs: VALID_CONFIG.cadenceMs,
      playerSystemPrompt: VALID_CONFIG.playerSystemPrompt,
      model: VALID_CONFIG.model,
    };
    const b = await writeTempConfig(reordered);
    const aLoaded = await loadControlConfig(a);
    const bLoaded = await loadControlConfig(b);
    expect(aLoaded.hash).toBe(bLoaded.hash);
  });

  test('hash changes when any field changes (FR-103 freeze detection)', async () => {
    const file = await writeTempConfig(VALID_CONFIG);
    const baseline = await loadControlConfig(file);
    const tweaked = { ...VALID_CONFIG, budgetUsd: 200 };
    const file2 = await writeTempConfig(tweaked);
    const tweakedLoaded = await loadControlConfig(file2);
    expect(tweakedLoaded.hash).not.toBe(baseline.hash);
  });

  test('rejects missing required fields', async () => {
    const partial = { ...VALID_CONFIG } as Partial<ControlConfig>;
    delete partial.budgetUsd;
    const file = await writeTempConfig(partial as object);
    await expect(loadControlConfig(file)).rejects.toThrow(/budgetUsd/);
  });

  test('rejects invalid types', async () => {
    const bad = { ...VALID_CONFIG, budgetUsd: 'not-a-number' };
    const file = await writeTempConfig(bad);
    await expect(loadControlConfig(file)).rejects.toThrow(/budgetUsd/);
  });

  test('hashControlConfig() matches loadControlConfig().hash', async () => {
    const file = await writeTempConfig(VALID_CONFIG);
    const loaded = await loadControlConfig(file);
    expect(hashControlConfig(loaded.config)).toBe(loaded.hash);
  });
});
