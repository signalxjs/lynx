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

  it('throws TypeError synchronously for a non-callable argument (web semantics)', () => {
    installGlobals();
    const qmt = g['queueMicrotask'] as (cb: unknown) => void;
    expect(() => qmt(undefined)).toThrow(TypeError);
    expect(() => qmt(123)).toThrow(TypeError);
    expect(() => qmt({})).toThrow(TypeError);
  });

  it("ignores the callback's return value — a returned rejected promise is not reported", async () => {
    installGlobals();
    // queueMicrotask ignores the callback's return value; only a *synchronous*
    // throw is an error. A polyfill that chained `.then(cb)` (instead of
    // `.then(() => cb())`) would ADOPT a returned rejected promise and re-throw
    // it via setTimeout — an uncaught error. Assert that path is NOT taken.
    let rethrown = false;
    const onUncaught = () => {
      rethrown = true;
    };
    process.on('uncaughtException', onUncaught);
    // Pre-handled so the rejection isn't an independent floating rejection —
    // the only way it could surface is the polyfill adopting + re-throwing it.
    const rejected = Promise.reject(new Error('returned-rejection-ignored'));
    rejected.catch(() => undefined);

    let ran = false;
    (g['queueMicrotask'] as (cb: () => unknown) => void)(() => {
      ran = true;
      return rejected;
    });
    await new Promise((r) => setTimeout(r, 10));
    process.off('uncaughtException', onUncaught);

    expect(ran).toBe(true);
    expect(rethrown).toBe(false);
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
