/**
 * #688 — `runOnMainThread` dispatches ride the ordered ops stream.
 *
 * The bug: the old direct `callLepusMethod('sigxRunOnMT')` channel shipped a
 * dispatch synchronously while the ops carrying the same mount window's
 * SharedValue/ref registrations sat in the op-queue awaiting their microtask
 * flush. The dispatch outran its own prerequisites: the worklet body threw
 * against a missing ref (contained, silent), and the `_initValue` seed then
 * applied over the lost correction — a bar stuck at a stale translateY on
 * the device, with byte-identical (correct) BG logs.
 *
 * In-stream, INVOKE_WORKLET applies strictly after every op enqueued before
 * it, and the op-queue's microtask flush makes dispatches from idle timer
 * contexts prompt without a render.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';
import { resetOpQueue, runOnMainThread } from '@sigx/lynx-runtime';

type RefEntry = { current: unknown; _wvid: number };

let refMap: Record<number, RefEntry>;
let workletMap: Record<string, (...args: unknown[]) => unknown>;

beforeEach(() => {
  resetMainThreadState();
  resetOpQueue();
  vi.unstubAllGlobals();
  vi.stubGlobal('__FlushElementTree', vi.fn());
  refMap = {};
  workletMap = {};
  vi.stubGlobal('lynxWorkletImpl', {
    _workletMap: workletMap,
    _refImpl: { _workletRefMap: refMap },
  });
});

describe('INVOKE_WORKLET op (#688)', () => {
  it('applies strictly in stream order: a dispatch enqueued after INIT_MT_REF sees the registered ref', () => {
    workletMap['w1'] = function (this: { _c: Record<string, unknown> }, ...args: unknown[]) {
      const v = args[0] as number;
      // The mount-window corrective write: needs the SV envelope to exist.
      const entry = refMap[42];
      (entry.current as { value: number }).value = v;
      return 'ran';
    };

    // One batch, registration first — the shape the BG now guarantees.
    applyOps([
      OP.INIT_MT_REF, 42, { value: 343 },
      OP.INVOKE_WORKLET, 'w1', [0], null,
    ]);

    expect((refMap[42].current as { value: number }).value).toBe(0);
  });

  it('respects stream order in the inverse direction too (contract documentation)', () => {
    // A dispatch enqueued BEFORE the registration runs before it: the
    // guarded INIT then seeds the still-missing ref. This is the historical
    // failure ordering — now impossible for same-window dispatches because
    // the BG enqueues render ops before effect-time dispatches, but the
    // stream contract itself is direction-agnostic.
    const seen: string[] = [];
    workletMap['w2'] = function () {
      seen.push(42 in refMap ? 'ref-present' : 'ref-missing');
    };

    applyOps([
      OP.INVOKE_WORKLET, 'w2', [], null,
      OP.INIT_MT_REF, 42, { value: 343 },
    ]);

    expect(seen).toEqual(['ref-missing']);
    expect((refMap[42].current as { value: number }).value).toBe(343);
  });

  it('contains a throwing worklet without aborting the rest of the batch', () => {
    workletMap['boom'] = function () {
      throw new Error('worklet exploded');
    };

    expect(() =>
      applyOps([
        OP.INVOKE_WORKLET, 'boom', [], null,
        OP.INIT_MT_REF, 7, { value: 1 },
      ])
    ).not.toThrow();
    expect(refMap[7]).toBeDefined();
  });

  it('reaches the MT promptly from an idle timer context — no render, no other ops', async () => {
    vi.useFakeTimers();
    try {
      const applied: unknown[][] = [];
      // Same-thread op transport: the queue's test fallback routes the
      // encoded batch straight to applyOps.
      vi.stubGlobal('sigxPatchUpdate', ({ data }: { data: string }) => {
        const ops = JSON.parse(data) as unknown[];
        applied.push(ops);
        applyOps(ops);
      });

      const calls: number[] = [];
      workletMap['timerW'] = function (...args: unknown[]) {
        calls.push(args[0] as number);
      };

      const dispatch = runOnMainThread({ _wkltId: 'timerW' } as never);
      setTimeout(() => { void dispatch(5); }, 1000);

      vi.advanceTimersByTime(1000);
      // The flush is a microtask queued by the dispatch itself — drain it.
      await Promise.resolve();
      await Promise.resolve();

      expect(calls).toEqual([5]);
      expect(applied).toHaveLength(1);
      expect(applied[0][0]).toBe(OP.INVOKE_WORKLET);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves the dispatch promise after the batch ack', async () => {
    vi.stubGlobal('sigxPatchUpdate', ({ data }: { data: string }) => {
      applyOps(JSON.parse(data) as unknown[]);
    });
    const calls: unknown[][] = [];
    workletMap['pW'] = function (...args: unknown[]) {
      calls.push(args);
      return 'mt-return';
    };

    const dispatch = runOnMainThread({ _wkltId: 'pW' } as never);
    const result = await dispatch(1, 'two');

    expect(calls).toEqual([[1, 'two']]);
    // Results no longer cross threads; the ack resolves undefined.
    expect(result).toBeUndefined();
  });

  it('legacy same-thread sigxRunOnMT stub still takes the direct path', async () => {
    const direct = vi.fn(
      (payload: { wkltId: string }, cb: (r: unknown) => void) => cb(`direct:${payload.wkltId}`),
    );
    vi.stubGlobal('sigxRunOnMT', direct);

    const dispatch = runOnMainThread({ _wkltId: 'legacy' } as never);
    const result = await dispatch();

    expect(direct).toHaveBeenCalledTimes(1);
    expect(result).toBe('direct:legacy');
  });
});

describe('per-batch flush acks (#691 review)', () => {
  it("an earlier batch's ack cannot resolve a later batch's waitForFlush promise", async () => {
    // Controllable async bridge: capture each batch's callback.
    const pendingCallbacks: Array<() => void> = [];
    vi.stubGlobal('lynx', {
      getNativeApp: () => ({
        callLepusMethod: (_m: string, _p: unknown, cb: () => void) => {
          pendingCallbacks.push(cb);
        },
      }),
    });

    const { pushOp, flushNow, waitForFlush } = await import('@sigx/lynx-runtime');

    pushOp(OP.INIT_MT_REF, 1, { value: 1 });
    flushNow();
    const batch1Ack = waitForFlush();

    pushOp(OP.INIT_MT_REF, 2, { value: 2 });
    flushNow();
    const batch2Ack = waitForFlush();

    expect(pendingCallbacks).toHaveLength(2);

    // Ack ONLY batch 1. Batch 2's promise must stay pending.
    let batch2Resolved = false;
    void batch2Ack.then(() => { batch2Resolved = true; });
    pendingCallbacks[0]();
    await batch1Ack;
    await Promise.resolve();
    expect(batch2Resolved).toBe(false);

    pendingCallbacks[1]();
    await batch2Ack;
    expect(batch2Resolved).toBe(true);
  });
});
