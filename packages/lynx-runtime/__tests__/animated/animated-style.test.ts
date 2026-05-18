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
