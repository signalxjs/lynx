/**
 * Tests for `useAnimatedMethod` BG factory (#844).
 *
 * Verifies the BG-side op emission shape; MT-side invoke application is
 * covered in `lynx-runtime-main/__tests__/animated-method.test.ts`.
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
  useAnimatedMethod,
  resetAnimatedMethodBindingIds,
  type AnimatedMethodSpec,
} from '../../src/animated/use-animated-method';
import type { MainThread } from '../../src/jsx';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
  resetAnimatedMethodBindingIds();
});

function makeElRef(): MainThreadRef<MainThread.Element | null> {
  return useMainThreadRef<MainThread.Element | null>(null);
}

describe('useAnimatedMethod', () => {
  it('pushes a REGISTER_AV_METHOD_BINDING op with the right shape', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    resetOpQueue(); // drop the INIT/REGISTER ops from useSharedValue + useMainThreadRef

    useAnimatedMethod(elRef, sv, 'setBottomInset', {
      valueKey: 'inset',
      params: { pin: true },
    });

    expect(takeOps()).toEqual([
      OP.REGISTER_AV_METHOD_BINDING,
      1,            // bindingId — counter starts at 1
      elRef._wvid,
      sv._wvid,
      'setBottomInset',
      'inset',
      { pin: true },
    ]);
  });

  it("defaults valueKey to 'value' and params to null", () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    resetOpQueue();

    useAnimatedMethod(elRef, sv, 'setProgress');

    expect(takeOps()).toEqual([
      OP.REGISTER_AV_METHOD_BINDING,
      1,
      elRef._wvid,
      sv._wvid,
      'setProgress',
      'value',
      null,
    ]);
  });
});

describe('useAnimatedMethod — reactive form', () => {
  it('emits nothing while the spec is null, then registers when it appears', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedMethodSpec | null }>({ value: null });
    resetOpQueue();

    useAnimatedMethod(elRef, () => box.value);
    expect(takeOps()).toEqual([]);

    box.value = { sv, methodName: 'setBottomInset', valueKey: 'inset', params: { pin: true } };
    expect(takeOps()).toEqual([
      OP.REGISTER_AV_METHOD_BINDING,
      1,
      elRef._wvid,
      sv._wvid,
      'setBottomInset',
      'inset',
      { pin: true },
    ]);
  });

  it('dedupes by signature — a fresh spec object with the same shape is a no-op', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedMethodSpec | null }>({
      value: { sv, methodName: 'setBottomInset', valueKey: 'inset', params: { pin: true } },
    });
    resetOpQueue();

    useAnimatedMethod(elRef, () => box.value);
    expect(takeOps().length).toBeGreaterThan(0); // initial register

    box.value = { sv, methodName: 'setBottomInset', valueKey: 'inset', params: { pin: true } };
    expect(takeOps()).toEqual([]);
  });

  it('rebinds when the signature changes (e.g. a different SV arrives)', () => {
    const sv1 = useSharedValue(0);
    const sv2 = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedMethodSpec | null }>({
      value: { sv: sv1, methodName: 'setBottomInset', valueKey: 'inset' },
    });
    resetOpQueue();

    useAnimatedMethod(elRef, () => box.value);
    const firstBindingId = takeOps()[1] as number;

    box.value = { sv: sv2, methodName: 'setBottomInset', valueKey: 'inset' };
    expect(takeOps()).toEqual([
      OP.UNREGISTER_AV_METHOD_BINDING,
      firstBindingId,
      OP.REGISTER_AV_METHOD_BINDING,
      firstBindingId + 1,
      elRef._wvid,
      sv2._wvid,
      'setBottomInset',
      'inset',
      null,
    ]);
  });

  it('unregisters when the spec goes back to null', () => {
    const sv = useSharedValue(0);
    const elRef = makeElRef();
    const box = signal<{ value: AnimatedMethodSpec | null }>({
      value: { sv, methodName: 'setBottomInset', valueKey: 'inset' },
    });
    resetOpQueue();

    useAnimatedMethod(elRef, () => box.value);
    const firstBindingId = takeOps()[1] as number;

    box.value = null;
    expect(takeOps()).toEqual([
      OP.UNREGISTER_AV_METHOD_BINDING,
      firstBindingId,
    ]);
  });
});
