// T141 [US8] — operator audit log (FR-130, FR-131, FR-132).

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { OperatorStore } from '../../src/dashboard/operator-store.js';

let store: OperatorStore;

beforeEach(() => {
  store = new OperatorStore(':memory:');
});

afterEach(() => {
  store.close();
});

describe('OperatorStore', () => {
  test('append + list (FR-130)', () => {
    const a = store.append({ kind: 'pause', payload: { scope: 'v2' }, authenticatedAs: 'op1' });
    expect(a.kind).toBe('pause');
    expect(a.id).toBeTruthy();
    expect(a.ts).toBeGreaterThan(0);
    const all = store.list({});
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe('pause');
  });

  test('infrastructure_note free-form payload (FR-131)', () => {
    store.append({ kind: 'infrastructure_note', payload: { note: 'restart at 14:00' }, authenticatedAs: 'op1' });
    const all = store.list({});
    expect(all[0]!.payload).toEqual({ note: 'restart at 14:00' });
  });

  test('hashes a token to a stable 16-char id', () => {
    const id1 = OperatorStore.hashToken('topsecret');
    const id2 = OperatorStore.hashToken('topsecret');
    const id3 = OperatorStore.hashToken('different');
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id1).toHaveLength(16);
  });

  test('list returns newest first (ts DESC, rowid DESC tie-break)', () => {
    // Two appends within the same ms — secondary sort on rowid keeps insertion order reversed.
    store.append({ kind: 'pause', authenticatedAs: 'op' });
    store.append({ kind: 'resume', authenticatedAs: 'op' });
    store.append({ kind: 'infrastructure_note', payload: { note: 'x' }, authenticatedAs: 'op' });
    const all = store.list({});
    expect(all[0]!.kind).toBe('infrastructure_note');
    expect(all[1]!.kind).toBe('resume');
    expect(all[2]!.kind).toBe('pause');
  });
});
