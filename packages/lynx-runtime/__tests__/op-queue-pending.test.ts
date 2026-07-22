/**
 * `pendingOps()` — the quiescence probe behind lynx-navigation's pre-stage
 * transition window (#651). It must report `true` for every stage of the
 * BG→MT pipeline (buffered ops, scheduled flush, sent-but-unacked batch)
 * and `false` only once the MT has applied everything.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  pushOp,
  scheduleFlush,
  flushNow,
  pendingOps,
  waitForFlush,
  resetOpQueue,
  OP,
} from '../src/op-queue';

describe('pendingOps', () => {
  beforeEach(() => {
    resetOpQueue();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['sigxPatchUpdate'];
    resetOpQueue();
  });

  it('is false when the queue is idle', () => {
    expect(pendingOps()).toBe(false);
  });

  it('is true with buffered ops, before and after scheduling', () => {
    pushOp(OP.SET_TEXT, 1, 'hi');
    expect(pendingOps()).toBe(true);
    scheduleFlush();
    expect(pendingOps()).toBe(true);
  });

  it('goes false after a same-thread flush is applied', async () => {
    (globalThis as Record<string, unknown>)['sigxPatchUpdate'] = () => {};
    pushOp(OP.SET_TEXT, 1, 'hi');
    scheduleFlush();
    await waitForFlush();
    // The microtask flush has run and the same-thread bridge acks
    // synchronously — nothing is in flight anymore.
    await Promise.resolve();
    expect(pendingOps()).toBe(false);
  });

  it('acks synchronously on the same-thread bridge and goes quiet', () => {
    let sent = 0;
    (globalThis as Record<string, unknown>)['sigxPatchUpdate'] = () => {
      sent++;
    };
    pushOp(OP.SET_TEXT, 1, 'hi');
    flushNow();
    expect(sent).toBe(1);
    // The same-thread fallback acks synchronously inside sendOps, so no
    // batch is left in flight.
    expect(pendingOps()).toBe(false);
  });
});
