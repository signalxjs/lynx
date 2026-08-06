/**
 * MT-side frame-callback driver (#933).
 *
 * Covers the driver contract the BG hook can't see: one shared rAF chain,
 * frame timing derived from `Date.now()`, and — the load-bearing one — that
 * the worklet ctx object is REUSED across frames so upstream's hydration
 * cache hits instead of re-walking `_c` (and re-`addRef`-ing every
 * `runOnBackground` handle) sixty times a second.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';
import { frameCallbackCount } from '../src/frame-callbacks-mt';

type RefEntry = { current: unknown };

let refMap: Record<number, RefEntry>;
/** Callbacks handed to `requestAnimationFrame`, awaiting a `drainFrame()`. */
let rafQueue: Array<() => void>;
let runWorklet: ReturnType<typeof vi.fn>;

/** Run every currently-queued rAF callback; returns how many fired. */
function drainFrame(): number {
  const due = rafQueue;
  rafQueue = [];
  due.forEach((cb) => cb());
  return due.length;
}

/** A ctx as it arrives off the wire (values are JSON-shaped, not class instances). */
function ctx(captured?: Record<string, unknown>): Record<string, unknown> {
  const c: Record<string, unknown> = { _wkltId: 'wklt-1', _execId: 1 };
  if (captured) c._c = captured;
  return c;
}

beforeEach(() => {
  resetMainThreadState();
  vi.unstubAllGlobals();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

  refMap = {};
  rafQueue = [];
  runWorklet = vi.fn();

  vi.stubGlobal('__FlushElementTree', vi.fn());
  vi.stubGlobal('lynxWorkletImpl', { _workletMap: {}, _refImpl: { _workletRefMap: refMap } });
  vi.stubGlobal('runWorklet', runWorklet);
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('registration and activation', () => {
  it('registers without ticking when inactive', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 0]);

    expect(frameCallbackCount()).toBe(1);
    expect(rafQueue).toHaveLength(0);
    expect(runWorklet).not.toHaveBeenCalled();
  });

  it('starts the chain when registered active, and self-sustains', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    expect(rafQueue).toHaveLength(1);

    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);
    // Exactly one continuation — the chain must never fork.
    expect(rafQueue).toHaveLength(1);

    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(2);
  });

  it('SET_FRAME_CALLBACK_ACTIVE starts a registered-inactive callback', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 0]);
    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 1]);

    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: repeated activation does not restart the run', () => {
    // A gesture calling startFrameCallback on every onUpdate must not reset
    // the run and hand the integrator dt = 0 every frame.
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    drainFrame();
    vi.advanceTimersByTime(16);

    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 1]);
    drainFrame();

    expect(frameOf(1).frameNumber).toBe(2);
    expect(frameOf(1).timeSincePreviousFrame).toBe(16);
    // No second chain was queued by the redundant activation.
    expect(rafQueue).toHaveLength(1);
  });

  it('stops chaining once deactivated', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);

    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0]);

    // The already-queued tick still fires — there is no dependable
    // cancelAnimationFrame — but invokes nothing and does not requeue.
    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(0);
  });

  it('resets the frame counters on restart', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    drainFrame();
    vi.advanceTimersByTime(16);
    drainFrame();
    expect(frameOf(1).frameNumber).toBe(2);

    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0]);
    drainFrame();
    vi.advanceTimersByTime(500);
    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 1]);
    drainFrame();

    const f = frameOf(1);
    expect(f.frameNumber).toBe(1);
    expect(f.timeSinceFirstFrame).toBe(0);
    expect(f.timeSincePreviousFrame).toBe(0);
  });

  it('unregisters and stops the chain', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    applyOps([OP.UNREGISTER_FRAME_CALLBACK, 1]);

    drainFrame();
    expect(runWorklet).not.toHaveBeenCalled();
    expect(rafQueue).toHaveLength(0);
    expect(frameCallbackCount()).toBe(0);
  });

  it('resetMainThreadState clears the registry and halts the chain', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    resetMainThreadState();

    drainFrame();
    expect(frameCallbackCount()).toBe(0);
    expect(runWorklet).not.toHaveBeenCalled();
    expect(rafQueue).toHaveLength(0);
  });
});

describe('frame timing', () => {
  it('reports 0 elapsed on the first frame of a run', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    drainFrame();

    expect(frameOf(1)).toEqual({
      timestamp: Date.now(),
      timeSinceFirstFrame: 0,
      timeSincePreviousFrame: 0,
      frameNumber: 1,
    });
  });

  it('accumulates elapsed time across frames', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    drainFrame();
    vi.advanceTimersByTime(16);
    drainFrame();
    vi.advanceTimersByTime(17);
    drainFrame();

    const f = frameOf(1);
    expect(f.timeSincePreviousFrame).toBe(17);
    expect(f.timeSinceFirstFrame).toBe(33);
    expect(f.frameNumber).toBe(3);
  });

  it('never hands the integrator a negative dt when the clock steps backwards', () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    drainFrame();
    vi.advanceTimersByTime(16);
    drainFrame();

    vi.setSystemTime(new Date(Date.now() - 5000));
    drainFrame();

    expect(frameOf(1).timeSincePreviousFrame).toBe(0);
    expect(frameOf(1).timeSinceFirstFrame).toBe(0);
  });
});

describe('multiple callbacks share one chain', () => {
  it('drives both from a single rAF and in registration order', () => {
    const seen: number[] = [];
    runWorklet.mockImplementation((c: Record<string, unknown>) => {
      seen.push(c._execId as number);
    });

    applyOps([
      OP.REGISTER_FRAME_CALLBACK, 1, { _wkltId: 'a', _execId: 1 }, 1,
      OP.REGISTER_FRAME_CALLBACK, 2, { _wkltId: 'b', _execId: 2 }, 1,
    ]);

    // Two active callbacks, ONE queued rAF: on the MT this is a host bridge
    // call, so a chain per callback would double the bridge traffic for
    // nothing.
    expect(rafQueue).toHaveLength(1);

    drainFrame();
    expect(seen).toEqual([1, 2]);
    expect(rafQueue).toHaveLength(1);
  });

  it('gives every callback in a frame the same timestamp', () => {
    const stamps: number[] = [];
    runWorklet.mockImplementation((_c: unknown, args: unknown[]) => {
      stamps.push((args[0] as { timestamp: number }).timestamp);
    });

    applyOps([
      OP.REGISTER_FRAME_CALLBACK, 1, { _wkltId: 'a' }, 1,
      OP.REGISTER_FRAME_CALLBACK, 2, { _wkltId: 'b' }, 1,
    ]);
    drainFrame();

    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toBe(stamps[1]);
  });

  it('keeps chaining while any callback is still active', () => {
    applyOps([
      OP.REGISTER_FRAME_CALLBACK, 1, { _wkltId: 'a' }, 1,
      OP.REGISTER_FRAME_CALLBACK, 2, { _wkltId: 'b' }, 1,
    ]);
    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0]);

    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(1);
  });
});

describe('ctx handling', () => {
  it('hands runWorklet the SAME ctx object every frame', () => {
    // The anti-leak guarantee. Upstream memoizes hydration in a WeakMap keyed
    // on ctx identity; a fresh object per frame would re-walk _c, re-bind, and
    // re-addRef every runOnBackground handle at 60fps.
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx({ sv: { _wvid: 5 } }), 1]);
    refMap[5] = { current: { value: 0 } };

    drainFrame();
    drainFrame();
    drainFrame();

    expect(runWorklet).toHaveBeenCalledTimes(3);
    const first = runWorklet.mock.calls[0]![0];
    expect(runWorklet.mock.calls[1]![0]).toBe(first);
    expect(runWorklet.mock.calls[2]![0]).toBe(first);
  });

  it('rebuilds the wire ctx onto Object.prototype', () => {
    // PrimJS's JSON.parse yields null-prototype objects, and upstream's
    // walker calls `new WeakRef(...)` on them, which PrimJS rejects.
    const wire = Object.assign(Object.create(null) as Record<string, unknown>, {
      _wkltId: 'w',
      _c: Object.assign(Object.create(null) as Record<string, unknown>, {
        sv: { _wvid: 5 },
      }),
    });
    refMap[5] = { current: { value: 0 } };

    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, wire, 1]);
    drainFrame();

    const stored = runWorklet.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(stored._c)).toBe(Object.prototype);
  });

  it('waits for an unresolved capture rather than baking it to undefined', () => {
    // Hydration happens once and overwrites the {_wvid} placeholder in place,
    // so hydrating before INIT_MT_REF lands would strand the slot as
    // undefined forever with no way to self-heal.
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx({ sv: { _wvid: 99 } }), 1]);

    drainFrame();
    expect(runWorklet).not.toHaveBeenCalled();
    // Still chaining, so it can pick up once the ref registers.
    expect(rafQueue).toHaveLength(1);

    applyOps([OP.INIT_MT_REF, 99, { value: 0 }]);
    drainFrame();

    expect(runWorklet).toHaveBeenCalledTimes(1);
    const c = runWorklet.mock.calls[0]![0] as { _c: Record<string, unknown> };
    expect(c._c.sv).toEqual({ _wvid: 99 });
  });

  it('gives up on a never-registered capture after the grace window', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx({ sv: { _wvid: 99 } }), 1]);

    for (let i = 0; i < 60; i++) drainFrame();

    expect(runWorklet).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('robustness', () => {
  it('contains a throwing callback and keeps its sibling running', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runWorklet.mockImplementation((c: Record<string, unknown>) => {
      if (c._wkltId === 'bad') throw new Error('boom');
    });

    applyOps([
      OP.REGISTER_FRAME_CALLBACK, 1, { _wkltId: 'bad' }, 1,
      OP.REGISTER_FRAME_CALLBACK, 2, { _wkltId: 'good' }, 1,
    ]);
    drainFrame();
    drainFrame();

    // Both were attempted both frames; the chain never stopped.
    expect(runWorklet).toHaveBeenCalledTimes(4);
    expect(rafQueue).toHaveLength(1);
    // Rate-limited to one line per 60 consecutive throwing frames.
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('falls back to a timer when requestAnimationFrame is absent', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);

    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(16);
    expect(runWorklet).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer when requestAnimationFrame throws', () => {
    // Upstream throws rather than being absent on Lynx SDK < 2.16, so a
    // `typeof === "function"` check alone would sail straight into it.
    vi.stubGlobal('requestAnimationFrame', () => {
      throw new Error('requestAnimationFrame in main thread script requires Lynx sdk version 2.16');
    });

    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    vi.advanceTimersByTime(16);

    expect(runWorklet).toHaveBeenCalledTimes(1);
  });

  it('flushes the element tree once per frame regardless of callback count', async () => {
    applyOps([
      OP.REGISTER_FRAME_CALLBACK, 1, { _wkltId: 'a' }, 1,
      OP.REGISTER_FRAME_CALLBACK, 2, { _wkltId: 'b' }, 1,
    ]);
    // applyOps flushes at the end of its own batch; count only the frame's.
    (globalThis.__FlushElementTree as unknown as ReturnType<typeof vi.fn>).mockClear();
    drainFrame();

    // The flush is microtask-coalesced through the latch shared with
    // SharedValue writes and motion ticks.
    await Promise.resolve();
    await Promise.resolve();

    const flush = globalThis.__FlushElementTree as unknown as ReturnType<typeof vi.fn>;
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('does not flush on a frame where nothing ran', async () => {
    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 1]);
    applyOps([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0]);
    const flush = globalThis.__FlushElementTree as unknown as ReturnType<typeof vi.fn>;
    flush.mockClear();

    drainFrame();
    await Promise.resolve();
    await Promise.resolve();

    expect(flush).not.toHaveBeenCalled();
  });
});

describe('worklet-initiated activation', () => {
  it('is reachable from a worklet via globalThis.__sigxFrameCallbacks', () => {
    // This is what lets a gesture's onEnd start a simulation in the frame the
    // finger lifts, instead of a BG round trip.
    const api = (globalThis as Record<string, unknown>)['__sigxFrameCallbacks'] as
      | { setActive: (id: number, active: boolean) => void }
      | undefined;
    expect(api).toBeDefined();

    applyOps([OP.REGISTER_FRAME_CALLBACK, 1, ctx(), 0]);
    api!.setActive(1, true);

    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);

    api!.setActive(1, false);
    drainFrame();
    expect(runWorklet).toHaveBeenCalledTimes(1);
  });
});

/** The FrameInfo handed to callback `id` on its most recent invocation. */
function frameOf(id: number): {
  timestamp: number;
  timeSinceFirstFrame: number;
  timeSincePreviousFrame: number;
  frameNumber: number;
} {
  void id;
  const calls = runWorklet.mock.calls;
  const last = calls[calls.length - 1]!;
  return last[1][0];
}
