/**
 * Tests for the BG-side runOnBackground bridge.
 *
 * Exercises the protocol that vue-lynx and upstream react-lynx implement:
 *   - transformToWorklet(fn) → JsFnHandle { _jsFnId, _fn } with toJSON shim
 *   - registerWorkletCtx(ctx) → stamps _execId on the ctx
 *   - 'Lynx.Sigx.RunOnBackground' event from MT → look up handle by
 *     (execId, fnId) inside the registered worklet ctx, run _fn, dispatch
 *     'Lynx.Sigx.FunctionCallRet' back with {resolveId, returnValue}
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CapturedListener {
  type: string;
  fn: (e: { data: string }) => void;
}

const captured: CapturedListener[] = [];
const dispatched: { type: string; data: string }[] = [];

const fakeCoreCtx = {
  addEventListener: vi.fn((type: string, fn: (e: { data: string }) => void) => {
    captured.push({ type, fn });
  }),
  dispatchEvent: vi.fn((e: { type: string; data: string }) => {
    dispatched.push(e);
  }),
};

beforeEach(async () => {
  captured.length = 0;
  dispatched.length = 0;
  fakeCoreCtx.addEventListener.mockClear();
  fakeCoreCtx.dispatchEvent.mockClear();
  vi.resetModules();
  vi.stubGlobal('lynx', { getCoreContext: () => fakeCoreCtx });
});

describe('transformToWorklet', () => {
  it('mints a JsFnHandle with monotonic ids and stores _fn', async () => {
    const { transformToWorklet, resetRunOnBackgroundState } = await import(
      '../src/run-on-background.js'
    );
    resetRunOnBackgroundState();
    const fn = (a: number, b: number) => a + b;
    const handle = transformToWorklet(fn as (...args: unknown[]) => unknown);
    expect(handle._jsFnId).toBe(1);
    expect(handle._fn).toBe(fn);

    const handle2 = transformToWorklet((() => {}) as (...args: unknown[]) => unknown);
    expect(handle2._jsFnId).toBe(2);
  });

  it('adds toJSON to the wrapped function so JSON.stringify drops the body', async () => {
    const { transformToWorklet, resetRunOnBackgroundState } = await import(
      '../src/run-on-background.js'
    );
    resetRunOnBackgroundState();
    const fn = (() => 1) as (...args: unknown[]) => unknown;
    transformToWorklet(fn);
    const json = JSON.stringify(fn);
    expect(json).toBe('"[BackgroundFunction]"');
  });

  it('returns an _error handle when the input is not a function', async () => {
    const { transformToWorklet, resetRunOnBackgroundState } = await import(
      '../src/run-on-background.js'
    );
    resetRunOnBackgroundState();
    const handle = transformToWorklet(42 as unknown as (...args: unknown[]) => unknown);
    expect(handle._error).toContain('should be a function');
    expect(handle._fn).toBeUndefined();
  });
});

describe('registerWorkletCtx', () => {
  it('stamps a unique _execId on each registered ctx and installs the listener', async () => {
    const { registerWorkletCtx, resetRunOnBackgroundState } = await import(
      '../src/run-on-background.js'
    );
    resetRunOnBackgroundState();

    const ctxA = { _wkltId: 'a' };
    const ctxB = { _wkltId: 'b' };
    registerWorkletCtx(ctxA);
    registerWorkletCtx(ctxB);

    expect((ctxA as { _execId?: number })._execId).toBe(1);
    expect((ctxB as { _execId?: number })._execId).toBe(2);
    // Listener wired on first registerWorkletCtx call.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.type).toBe('Lynx.Sigx.RunOnBackground');
  });
});

describe('runJSFunction (MT → BG dispatch)', () => {
  it('finds the handle by (execId, fnId), runs _fn, dispatches FunctionCallRet', async () => {
    const {
      registerWorkletCtx,
      transformToWorklet,
      resetRunOnBackgroundState,
    } = await import('../src/run-on-background.js');
    resetRunOnBackgroundState();

    const fn = vi.fn((a: number, b: number) => a + b);
    const handle = transformToWorklet(fn as (...args: unknown[]) => unknown);
    const ctx = {
      _wkltId: 'wkltA',
      _jsFn: { _jsFn1: handle },
    };
    registerWorkletCtx(ctx);
    const execId = (ctx as { _execId?: number })._execId!;

    captured[0]!.fn({
      data: JSON.stringify({
        obj: { _execId: execId, _jsFnId: handle._jsFnId },
        params: [3, 4],
        resolveId: 99,
      }),
    });

    expect(fn).toHaveBeenCalledWith(3, 4);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.type).toBe('Lynx.Sigx.FunctionCallRet');
    expect(JSON.parse(dispatched[0]!.data)).toEqual({
      resolveId: 99,
      returnValue: 7,
    });
  });

  it('finds nested handles inside the worklet ctx graph', async () => {
    const {
      registerWorkletCtx,
      transformToWorklet,
      resetRunOnBackgroundState,
    } = await import('../src/run-on-background.js');
    resetRunOnBackgroundState();

    const fn = vi.fn(() => 'ok');
    const handle = transformToWorklet(fn);
    const ctx = {
      _wkltId: 'nested',
      _c: { deep: { obj: { handle } } },
    };
    registerWorkletCtx(ctx);
    const execId = (ctx as { _execId?: number })._execId!;

    captured[0]!.fn({
      data: JSON.stringify({
        obj: { _execId: execId, _jsFnId: handle._jsFnId },
        params: [],
        resolveId: 1,
      }),
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(dispatched[0]!.data).returnValue).toBe('ok');
  });

  it('resolves with undefined when the handle is missing (stale ctx)', async () => {
    const { resetRunOnBackgroundState, registerWorkletCtx } = await import(
      '../src/run-on-background.js'
    );
    resetRunOnBackgroundState();

    // Register an empty ctx so the listener exists but no handle matches.
    registerWorkletCtx({ _wkltId: 'empty' });

    captured[0]!.fn({
      data: JSON.stringify({
        obj: { _execId: 1, _jsFnId: 999 },
        params: [],
        resolveId: 7,
      }),
    });

    expect(dispatched).toHaveLength(1);
    expect(JSON.parse(dispatched[0]!.data)).toEqual({
      resolveId: 7,
      returnValue: undefined,
    });
  });

  it('drops malformed JSON without throwing', async () => {
    const { resetRunOnBackgroundState, registerWorkletCtx } = await import(
      '../src/run-on-background.js'
    );
    resetRunOnBackgroundState();
    registerWorkletCtx({ _wkltId: 'x' });

    expect(() => captured[0]!.fn({ data: 'not-json' })).not.toThrow();
    expect(dispatched).toHaveLength(0);
  });
});

describe('user-facing runOnBackground stub', () => {
  it('throws when called on BG (build transform did not run)', async () => {
    const { runOnBackground } = await import('../src/run-on-background.js');
    expect(() => runOnBackground(() => undefined)).toThrow(/'main thread'/);
  });
});
