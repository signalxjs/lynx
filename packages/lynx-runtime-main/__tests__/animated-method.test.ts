/**
 * #844 — animated METHOD bindings. A SharedValue drives a native UI method on
 * a bound element: on every flush where the SV's value changed, the MT runtime
 * invokes `methodName` with `{...params, [valueKey]: value}`. Same fake-ref-map
 * driving pattern as animated-bridge.test.ts / derived-values.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OP } from '@sigx/lynx-runtime-internal';

import { applyOps, resetMainThreadState } from '../src/ops-apply';
import {
  flushAnimatedMethodBindings,
  animatedMethodBindingCount,
} from '../src/animated-bridge-mt';
import { flushDerivedValues } from '../src/derived-values-mt';

interface FakeRef {
  current: unknown;
}

function refMap(): Record<number, FakeRef> {
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    { _refImpl: { _workletRefMap: Record<number, FakeRef> } } | undefined;
  if (!impl?._refImpl) throw new Error('worklet runtime not initialized');
  return impl._refImpl._workletRefMap;
}

function seedEnvelope(wvid: number, value: unknown): { current: { value: unknown } } {
  const ref = { current: { value } };
  refMap()[wvid] = ref;
  return ref;
}

/** Seed an element ref the way `main-thread:ref` binding does: the wrapper
 * carries the raw element under `_el`, which the method flush unwraps. */
function seedElementRef(wvid: number): { rawEl: { id: number } } {
  const rawEl = { id: wvid };
  refMap()[wvid] = { current: { _el: rawEl } };
  return { rawEl };
}

let invokeUIMethod: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('__FlushElementTree', vi.fn());
  invokeUIMethod = vi.fn();
  vi.stubGlobal('__InvokeUIMethod', invokeUIMethod);
  vi.stubGlobal('lynx', {
    SystemInfo: { lynxSdkVersion: '3.5.0' },
    getJSContext: () => ({ dispatchEvent: vi.fn(), addEventListener: vi.fn() }),
  });
  vi.stubGlobal('lynxWorkletImpl', {
    _workletMap: {},
    _refImpl: { _workletRefMap: {} as Record<number, FakeRef> },
  });
  resetMainThreadState();
});

describe('animated method bindings (#844)', () => {
  it('REGISTER/UNREGISTER_AV_METHOD_BINDING track the binding', () => {
    applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', null]);
    expect(animatedMethodBindingCount()).toBe(1);
    applyOps([OP.UNREGISTER_AV_METHOD_BINDING, 100]);
    expect(animatedMethodBindingCount()).toBe(0);
  });

  it('first flush invokes with the initial value and merged params', () => {
    seedEnvelope(1, 12);
    const { rawEl } = seedElementRef(2);
    applyOps([
      OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', { pin: true },
    ]);
    // applyOps' tail already ran flushAnimatedMethodBindings (first-apply).
    expect(invokeUIMethod).toHaveBeenCalledTimes(1);
    expect(invokeUIMethod).toHaveBeenCalledWith(
      rawEl, 'setBottomInset', { pin: true, inset: 12 }, expect.any(Function),
    );
  });

  it('does not re-invoke while the value is unchanged; re-invokes on change', () => {
    const sv = seedEnvelope(1, 0);
    seedElementRef(2);
    applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', null]);
    expect(invokeUIMethod).toHaveBeenCalledTimes(1);

    flushAnimatedMethodBindings();
    flushAnimatedMethodBindings();
    expect(invokeUIMethod).toHaveBeenCalledTimes(1);

    sv.current.value = 250;
    flushAnimatedMethodBindings();
    expect(invokeUIMethod).toHaveBeenCalledTimes(2);
    expect(invokeUIMethod).toHaveBeenLastCalledWith(
      expect.anything(), 'setBottomInset', { inset: 250 }, expect.any(Function),
    );
  });

  it('stays dirty while the element is unresolved and applies once it mounts', () => {
    seedEnvelope(1, 99);
    applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 7, 1, 'setBottomInset', 'inset', null]);
    expect(invokeUIMethod).not.toHaveBeenCalled();

    // The SV never changes again (keyboard settled). Element mounts later:
    const { rawEl } = seedElementRef(7);
    flushAnimatedMethodBindings();
    expect(invokeUIMethod).toHaveBeenCalledTimes(1);
    expect(invokeUIMethod).toHaveBeenCalledWith(
      rawEl, 'setBottomInset', { inset: 99 }, expect.any(Function),
    );
  });

  it('stays dirty when the invoke throws synchronously, and retries', () => {
    seedEnvelope(1, 10);
    seedElementRef(2);
    invokeUIMethod.mockImplementationOnce(() => {
      throw new Error('layout transition');
    });
    applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', null]);
    expect(invokeUIMethod).toHaveBeenCalledTimes(1); // threw

    flushAnimatedMethodBindings(); // retry succeeds
    expect(invokeUIMethod).toHaveBeenCalledTimes(2);
    expect(invokeUIMethod).toHaveBeenLastCalledWith(
      expect.anything(), 'setBottomInset', { inset: 10 }, expect.any(Function),
    );

    flushAnimatedMethodBindings(); // applied — no further invoke
    expect(invokeUIMethod).toHaveBeenCalledTimes(2);
  });

  it('a binding to a derived SV sees the fresh fold the same flush', () => {
    seedEnvelope(10, 0); // derived target
    const kb = seedEnvelope(1, 0);
    const sheet = seedEnvelope(2, 0);
    seedElementRef(3);
    applyOps([
      OP.REGISTER_AV_DERIVED, 10, 'max', null, [1, 2],
      OP.REGISTER_AV_METHOD_BINDING, 100, 3, 10, 'setBottomInset', 'inset', null,
    ]);
    kb.current.value = 120;
    sheet.current.value = 340;
    // Mirror the wrapped-__FlushElementTree ordering: derived fold first,
    // then method bindings.
    flushDerivedValues();
    flushAnimatedMethodBindings();
    expect(invokeUIMethod).toHaveBeenLastCalledWith(
      expect.anything(), 'setBottomInset', { inset: 340 }, expect.any(Function),
    );
  });

  it('unregister stops invokes', () => {
    const sv = seedEnvelope(1, 0);
    seedElementRef(2);
    applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', null]);
    expect(invokeUIMethod).toHaveBeenCalledTimes(1);

    applyOps([OP.UNREGISTER_AV_METHOD_BINDING, 100]);
    sv.current.value = 500;
    flushAnimatedMethodBindings();
    expect(invokeUIMethod).toHaveBeenCalledTimes(1);
  });

  it('degrades to a no-op when __InvokeUIMethod is absent (web host)', () => {
    vi.stubGlobal('__InvokeUIMethod', undefined);
    seedEnvelope(1, 10);
    seedElementRef(2);
    expect(() => {
      applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', null]);
      flushAnimatedMethodBindings();
    }).not.toThrow();
  });

  it('resetMainThreadState clears method bindings', () => {
    applyOps([OP.REGISTER_AV_METHOD_BINDING, 100, 2, 1, 'setBottomInset', 'inset', null]);
    expect(animatedMethodBindingCount()).toBe(1);
    resetMainThreadState();
    expect(animatedMethodBindingCount()).toBe(0);
  });
});
