// EventBus — buffer + snapshot (T082) used by the SSE backfill path.

import { describe, expect, test } from 'vitest';
import { EventBus } from '../../src/dashboard/event-bus.js';

describe('EventBus', () => {
  test('emits + buffers events with monotonic ids', () => {
    const bus = new EventBus();
    bus.emit('cycle_record', { cycle: 1 });
    bus.emit('cycle_record', { cycle: 2 });
    const all = bus.all();
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(1);
    expect(all[1]!.id).toBe(2);
    expect(all[0]!.event).toBe('cycle_record');
  });

  test('snapshotAfter filters by id', () => {
    const bus = new EventBus();
    bus.emit('a', { x: 1 });
    bus.emit('b', { x: 2 });
    bus.emit('c', { x: 3 });
    const after = bus.snapshotAfter(1);
    expect(after).toHaveLength(2);
    expect(after[0]!.event).toBe('b');
  });

  test('drops oldest entries when bufferSize exceeded', () => {
    const bus = new EventBus({ bufferSize: 3 });
    bus.emit('a', {});
    bus.emit('b', {});
    bus.emit('c', {});
    bus.emit('d', {});
    const all = bus.all();
    expect(all).toHaveLength(3);
    expect(all[0]!.event).toBe('b');
  });

  test('listeners receive emit', () => {
    const bus = new EventBus();
    const received: unknown[] = [];
    bus.on('cycle_record', (data) => received.push(data));
    bus.emit('cycle_record', { cycle: 5 });
    expect(received).toEqual([{ cycle: 5 }]);
  });
});
