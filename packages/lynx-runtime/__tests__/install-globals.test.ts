/**
 * BG bootstrap installs the web-standard `queueMicrotask` global, which Lynx's
 * background thread otherwise exposes only as `lynx.queueMicrotask`. See
 * install-globals.ts and signalxjs/lynx#296.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installGlobals } from '../src/install-globals';

type G = Record<string, unknown>;
const g = globalThis as G;

describe('installGlobals: queueMicrotask', () => {
  let savedQMT: unknown;

  beforeEach(() => {
    savedQMT = g['queueMicrotask'];
    delete g['queueMicrotask'];
  });

  afterEach(() => {
    if (savedQMT === undefined) delete g['queueMicrotask'];
    else g['queueMicrotask'] = savedQMT;
  });

  it('installs queueMicrotask when absent', () => {
    expect(typeof g['queueMicrotask']).not.toBe('function');
    installGlobals();
    expect(typeof g['queueMicrotask']).toBe('function');
  });

  it('schedules the callback on a microtask (async, not sync)', async () => {
    installGlobals();
    let ran = false;
    (g['queueMicrotask'] as (cb: () => void) => void)(() => {
      ran = true;
    });
    expect(ran).toBe(false); // microtask — not yet
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it('preserves FIFO order across multiple scheduled callbacks', async () => {
    installGlobals();
    const order: number[] = [];
    const qmt = g['queueMicrotask'] as (cb: () => void) => void;
    qmt(() => order.push(1));
    qmt(() => order.push(2));
    qmt(() => order.push(3));
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not clobber a pre-existing global (newer engine / host-provided)', () => {
    const existing = vi.fn();
    g['queueMicrotask'] = existing;
    installGlobals();
    expect(g['queueMicrotask']).toBe(existing);
  });

  it('is idempotent — a second call keeps the first install', () => {
    installGlobals();
    const first = g['queueMicrotask'];
    installGlobals();
    expect(g['queueMicrotask']).toBe(first);
  });
});
