/**
 * Tests for `useAnimatedStyle` BG factory.
 *
 * Verifies the BG-side op emission shape; MT-side mapper application is
 * covered in `lynx-runtime-main/__tests__/animated-bridge.test.ts`.
 *
 * History: lived in @sigx/gestures during Phase 2.5; promoted to @sigx/lynx
 * in Phase 2.6 (PHASE-2.6-LAYERING-MOTION-INTEROP-PLAN.md).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@sigx/reactivity';

import { OP, takeOps, resetOpQueue } from '../../src/op-queue';
import {
  useMainThreadRef,
  resetWvidCounter,
  type MainThreadRef,
} from '../../src/main-thread-ref';
import { resetBgAvBridge } from '../../src/animated-bridge';
import { useSharedValue } from '../../src/animated/shared-value';
import {
  useAnimatedStyle,
  resetAnimatedStyleBindingIds,
  type AnimatedStyleSpec,
} from '../../src/animated/use-animated-style';
import type { MainThread } from '../../src/jsx';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
  resetAnimatedStyleBindingIds();
});

function makeElRef(): MainThreadRef<MainThread.Element | null> {
  return useMainThreadRef<MainThread.Element | null>(null);
}

describe('useAnimatedStyle', () => {
  it('pushes a REGISTER_AV_STYLE_BINDING op with the right shape', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    resetOpQueue(); // drop the INIT/REGISTER ops from useSharedValue + useMainThreadRef

    useAnimatedStyle(elRef, sv, 'translateX', { factor: 0.5 });

    const ops = takeOps();
    expect(ops).toEqual([
      OP.REGISTER_AV_STYLE_BINDING,
      1,            // bindingId — counter starts at 1
      elRef._wvid,
      sv._wvid,
      'translateX',
      { factor: 0.5 },
    ]);
  });

  it('omits params as null when none are passed', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    resetOpQueue();

    useAnimatedStyle(elRef, sv, 'opacity');

    const ops = takeOps();
    expect(ops).toEqual([
      OP.REGISTER_AV_STYLE_BINDING,
      1,
      elRef._wvid,
      sv._wvid,
      'opacity',
      null,
    ]);
  });

  it('allocates a unique bindingId per call', () => {
    const sv = useSharedValue(0);
    const el1 = makeElRef();
    const el2 = makeElRef();
    resetOpQueue();

    useAnimatedStyle(el1, sv, 'translateX');
    useAnimatedStyle(el2, sv, 'translateX', { factor: 0.5 });

    const ops = takeOps();
    expect(ops[1]).toBe(1); // first bindingId
    expect(ops[7]).toBe(2); // second bindingId
  });
});

describe('useAnimatedStyle — reactive form', () => {
  it('registers a binding for the initial non-null spec', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    resetOpQueue();

    useAnimatedStyle(elRef, () => ({
      sv,
      mapperName: 'translateX',
      params: { factor: 0.5 },
    }));

    const ops = takeOps();
    expect(ops).toEqual([
      OP.REGISTER_AV_STYLE_BINDING,
      1,
      elRef._wvid,
      sv._wvid,
      'translateX',
      { factor: 0.5 },
    ]);
  });

  it('emits nothing while the spec stays null, then registers when it appears', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedStyleSpec | null }>({ value: null });
    resetOpQueue();

    useAnimatedStyle(elRef, () => box.value);
    // Null spec → no binding op.
    expect(takeOps()).toEqual([]);

    box.value = { sv, mapperName: 'translateX', params: { factor: 1 } };
    const ops = takeOps();
    expect(ops).toEqual([
      OP.REGISTER_AV_STYLE_BINDING,
      1,
      elRef._wvid,
      sv._wvid,
      'translateX',
      { factor: 1 },
    ]);
  });

  it('dedupes by signature — a fresh spec object with the same shape is a no-op', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedStyleSpec | null }>({
      value: { sv, mapperName: 'translateX', params: { factor: 1 } },
    });
    resetOpQueue();

    useAnimatedStyle(elRef, () => box.value);
    expect(takeOps().length).toBeGreaterThan(0); // initial register

    // New object, identical signature (same sv, mapper, params) — must NOT
    // re-register. This is what stops binding thrash on every re-render.
    box.value = { sv, mapperName: 'translateX', params: { factor: 1 } };
    expect(takeOps()).toEqual([]);
  });

  it('rebinds (unregister old + register new) when the signature changes', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedStyleSpec | null }>({
      value: { sv, mapperName: 'translateX', params: { factor: 1 } },
    });
    resetOpQueue();

    useAnimatedStyle(elRef, () => box.value);
    const initial = takeOps();
    const firstBindingId = initial[1] as number;

    box.value = { sv, mapperName: 'translateX', params: { factor: 2 } };
    const ops = takeOps();
    expect(ops).toEqual([
      OP.UNREGISTER_AV_STYLE_BINDING,
      firstBindingId,
      OP.REGISTER_AV_STYLE_BINDING,
      firstBindingId + 1,
      elRef._wvid,
      sv._wvid,
      'translateX',
      { factor: 2 },
    ]);
  });

  it('unregisters when the spec goes back to null', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedStyleSpec | null }>({
      value: { sv, mapperName: 'translateX', params: { factor: 1 } },
    });
    resetOpQueue();

    useAnimatedStyle(elRef, () => box.value);
    const firstBindingId = takeOps()[1] as number;

    box.value = null;
    expect(takeOps()).toEqual([
      OP.UNREGISTER_AV_STYLE_BINDING,
      firstBindingId,
    ]);
  });
});
