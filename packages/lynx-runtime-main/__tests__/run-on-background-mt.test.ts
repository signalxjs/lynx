/**
 * Tests for the MT-side runOnBackground dispatcher.
 *
 * Validates the protocol shape that vue-lynx and upstream react-lynx use:
 *   - dispatch via lynx.getJSContext().dispatchEvent('Lynx.Sigx.RunOnBackground', ...)
 *   - listener on lynx.getJSContext() for 'Lynx.Sigx.FunctionCallRet' resolves
 *     the pending Promise by resolveId
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CapturedListener {
  type: string;
  fn: (e: { data: string }) => void;
}

const captured: CapturedListener[] = [];
const dispatched: { type: string; data: string }[] = [];

const fakeJSCtx = {
  addEventListener: vi.fn((type: string, fn: (e: { data: string }) => void) => {
    captured.push({ type, fn });
  }),
  dispatchEvent: vi.fn((e: { type: string; data: string }) => {
    dispatched.push(e);
  }),
};

beforeEach(() => {
  captured.length = 0;
  dispatched.length = 0;
  fakeJSCtx.addEventListener.mockClear();
  fakeJSCtx.dispatchEvent.mockClear();
  vi.resetModules();
  vi.stubGlobal('lynx', { getJSContext: () => fakeJSCtx });
});

describe('runOnBackground (MT)', () => {
  it('returns a callable that dispatches Lynx.Sigx.RunOnBackground', async () => {
    const { runOnBackground, resetRunOnBackgroundMtState } = await import(
      '../src/run-on-background-mt.js'
    );
    resetRunOnBackgroundMtState();

    const call = runOnBackground({ _jsFnId: 7, _execId: 3 });
    void call(1, 'two');

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.type).toBe('Lynx.Sigx.RunOnBackground');
    const payload = JSON.parse(dispatched[0]!.data);
    expect(payload.obj).toEqual({ _jsFnId: 7, _execId: 3 });
    expect(payload.params).toEqual([1, 'two']);
    expect(typeof payload.resolveId).toBe('number');
  });

  it('installs the FunctionCallRet listener once on first dispatch', async () => {
    const { runOnBackground, resetRunOnBackgroundMtState } = await import(
      '../src/run-on-background-mt.js'
    );
    resetRunOnBackgroundMtState();

    void runOnBackground({ _jsFnId: 1, _execId: 1 })();
    void runOnBackground({ _jsFnId: 2, _execId: 1 })();

    expect(captured).toHaveLength(1);
    expect(captured[0]!.type).toBe('Lynx.Sigx.FunctionCallRet');
  });

  it('resolves the promise when FunctionCallRet matches the resolveId', async () => {
    const { runOnBackground, resetRunOnBackgroundMtState } = await import(
      '../src/run-on-background-mt.js'
    );
    resetRunOnBackgroundMtState();

    const promise = runOnBackground({ _jsFnId: 1, _execId: 1 })();
    const resolveId = JSON.parse(dispatched[0]!.data).resolveId;

    captured[0]!.fn({
      data: JSON.stringify({ resolveId, returnValue: 'pong' }),
    });

    await expect(promise).resolves.toBe('pong');
  });

  it('does not resolve when the resolveId does not match', async () => {
    const { runOnBackground, resetRunOnBackgroundMtState } = await import(
      '../src/run-on-background-mt.js'
    );
    resetRunOnBackgroundMtState();

    const promise = runOnBackground({ _jsFnId: 1, _execId: 1 })();
    let settled = false;
    promise.then(() => { settled = true; });

    captured[0]!.fn({
      data: JSON.stringify({ resolveId: 99999, returnValue: 'wrong' }),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);
  });

  it('resolves undefined when handle has no _jsFnId/_execId pair', async () => {
    const { runOnBackground, resetRunOnBackgroundMtState } = await import(
      '../src/run-on-background-mt.js'
    );
    resetRunOnBackgroundMtState();

    // Empty handle (e.g. transform never ran or _execId never stamped).
    await expect(runOnBackground({})()).resolves.toBeUndefined();
    // No dispatch sent — the call short-circuits.
    expect(dispatched).toHaveLength(0);
  });

  it('drops malformed FunctionCallRet payloads', async () => {
    const { runOnBackground, resetRunOnBackgroundMtState } = await import(
      '../src/run-on-background-mt.js'
    );
    resetRunOnBackgroundMtState();
    void runOnBackground({ _jsFnId: 1, _execId: 1 })();

    expect(() => captured[0]!.fn({ data: 'not-json' })).not.toThrow();
  });
});
