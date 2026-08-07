/**
 * Tests for the `useFrameCallback` BG factory (#933).
 *
 * Verifies the BG-side op emission shape; the MT-side driver (shared rAF
 * chain, frame timing, ctx identity) is covered in
 * `lynx-runtime-main/__tests__/frame-callbacks.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setCurrentInstance } from '@sigx/runtime-core/internals';

import { OP, takeOps, resetOpQueue } from '../src/op-queue';
import { useMainThreadRef, resetWvidCounter } from '../src/main-thread-ref';
import { resetBgAvBridge } from '../src/animated-bridge';
import { useSharedValue } from '../src/animated/shared-value';
import {
  useFrameCallback,
  resetFrameCallbackIds,
  type FrameInfo,
} from '../src/use-frame-callback';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
  resetFrameCallbackIds();
});

/**
 * Stand in for what the SWC LEPUS transform leaves behind. Tests run in plain
 * node, where the `'main thread'` directive is just a string expression and
 * the function is never replaced — so every test builds the placeholder by
 * hand, exactly as it would arrive on the wire.
 */
function placeholder(
  captured?: Record<string, unknown>,
): (frame: FrameInfo) => void {
  const ctx: Record<string, unknown> = { _wkltId: 'wklt-frame-1' };
  if (captured) ctx._c = captured;
  return ctx as unknown as (frame: FrameInfo) => void;
}

/** Run `fn` inside a fake component context, collecting its unmount hooks. */
function withComponent<T>(fn: () => T): { result: T; unmount: () => void } {
  const hooks: Array<() => void> = [];
  const fakeCtx = {
    onUnmounted: (h: () => void) => hooks.push(h),
  } as unknown as Parameters<typeof setCurrentInstance>[0];
  const prev = setCurrentInstance(fakeCtx);
  let result: T;
  try {
    result = fn();
  } finally {
    setCurrentInstance(prev);
  }
  return { result, unmount: () => hooks.forEach((h) => h()) };
}

describe('useFrameCallback registration', () => {
  it('pushes REGISTER_FRAME_CALLBACK inactive by default', () => {
    useFrameCallback(placeholder());

    const ops = takeOps();
    expect(ops[0]).toBe(OP.REGISTER_FRAME_CALLBACK);
    expect(ops[1]).toBe(1); // fcId — counter starts at 1
    expect(ops[3]).toBe(0); // not autostarted
  });

  it('marks the registration active when autostart is set', () => {
    useFrameCallback(placeholder(), { autostart: true });
    expect(takeOps()[3]).toBe(1);
  });

  it('ships the full transform-emitted ctx', () => {
    // Dropping _jsFn/_execId breaks hydration on the MT with
    // "Cannot destructure property '_jsFn1'", so every field must survive.
    const raw = {
      _wkltId: 'wklt-frame-1',
      _jsFn: { _jsFn1: { _jsFnId: 7 } },
    } as unknown as (frame: FrameInfo) => void;

    useFrameCallback(raw);

    const ctx = takeOps()[2] as Record<string, unknown>;
    expect(ctx._wkltId).toBe('wklt-frame-1');
    expect(ctx._jsFn).toEqual({ _jsFn1: { _jsFnId: 7 } });
    expect(ctx._workletType).toBe('main-thread');
    // registerWorkletCtx stamps this so runOnBackground works in the body.
    expect(typeof ctx._execId).toBe('number');
  });

  it('sanitizes MainThreadRef captures so they survive the JSON round trip', () => {
    const sv = useSharedValue(0);
    const elRef = useMainThreadRef<string | null>(null);
    resetOpQueue(); // drop the INIT/REGISTER ops from the two refs

    useFrameCallback(placeholder({ sv, elRef }));

    const ctx = takeOps()[2] as { _c: Record<string, unknown> };
    // A SharedValue's init value is the `{ value }` envelope, not the raw
    // initial — that envelope is what the MT ref map holds.
    expect(ctx._c.sv).toEqual({ _wvid: sv._wvid, _initValue: { value: 0 } });
    expect(ctx._c.elRef).toEqual({ _wvid: elRef._wvid, _initValue: null });
    // The real proof: the whole ctx has to cross as JSON.
    expect(() => JSON.stringify(ctx)).not.toThrow();
  });

  it("does not mutate the caller's placeholder object", () => {
    const raw = { _wkltId: 'w', _c: {} } as unknown as (frame: FrameInfo) => void;
    useFrameCallback(raw);
    expect((raw as unknown as Record<string, unknown>)._workletType).toBeUndefined();
  });

  it('allocates increasing ids, rewound by the test reset hook', () => {
    useFrameCallback(placeholder());
    useFrameCallback(placeholder());
    const ops = takeOps();
    expect(ops[1]).toBe(1);
    expect(ops[5]).toBe(2);

    resetFrameCallbackIds();
    resetOpQueue();
    useFrameCallback(placeholder());
    expect(takeOps()[1]).toBe(1);
  });

  it('throws a package-prefixed error when the worklet transform did not run', () => {
    // A bare function means the body is unreachable on the MT — better to
    // fail loudly than tick forever doing nothing.
    expect(() => useFrameCallback(() => {})).toThrowError(
      /^\[@sigx\/lynx-runtime\] useFrameCallback:/,
    );
  });
});

describe('useFrameCallback controls', () => {
  it('emits SET_FRAME_CALLBACK_ACTIVE for start and stop', () => {
    const fc = useFrameCallback(placeholder());
    resetOpQueue();

    fc.start();
    expect(takeOps()).toEqual([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 1]);

    fc.stop();
    expect(takeOps()).toEqual([OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0]);
  });

  it('does NOT dedupe repeated stop() calls', () => {
    // The MT can flip the flag on its own (`stopFrameCallback` from inside
    // the worklet), so a BG-side mirror would be stale — and would swallow
    // exactly the start() meant to resume a self-stopped loop.
    const fc = useFrameCallback(placeholder());
    resetOpQueue();

    fc.stop();
    fc.stop();

    expect(takeOps()).toEqual([
      OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0,
      OP.SET_FRAME_CALLBACK_ACTIVE, 1, 0,
    ]);
  });

  it('emits UNREGISTER_FRAME_CALLBACK exactly once, and goes inert after', () => {
    const fc = useFrameCallback(placeholder());
    resetOpQueue();

    fc.dispose();
    expect(takeOps()).toEqual([OP.UNREGISTER_FRAME_CALLBACK, 1]);

    fc.dispose();
    fc.start();
    fc.stop();
    expect(takeOps()).toEqual([]);
  });

  it('disposes on unmount', () => {
    const { result: fc, unmount } = withComponent(() => useFrameCallback(placeholder()));
    resetOpQueue();

    unmount();
    expect(takeOps()).toEqual([OP.UNREGISTER_FRAME_CALLBACK, fc._fcid]);
  });

  it('exposes the wire id, which is what survives capture into a worklet', () => {
    const fc = useFrameCallback(placeholder());
    // startFrameCallback(fc) works because JSON keeps _fcid and drops the
    // methods.
    expect(JSON.parse(JSON.stringify(fc))).toEqual({ _fcid: fc._fcid });
  });
});
