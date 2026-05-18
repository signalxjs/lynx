/**
 * Tests for `useSharedValue` — the bridged BG-observable cross-thread value.
 *
 * Verifies the BG-side composition: factory allocates a MainThreadRef
 * (so `instanceof MainThreadRef` holds for the worklet-ctx serializer),
 * registers a BG signal mirror under the same wvid, and pushes the
 * INIT_MT_REF + REGISTER_AV_BRIDGE ops in that order. The MT-side flush
 * + ingest path is tested in lynx-runtime-main + the animated-bridge tests
 * in this package.
 *
 * History: lived in @sigx/gestures during Phase 2.5; promoted to @sigx/lynx
 * in Phase 2.6; renamed from `AnimatedValue` to `SharedValue` in Phase 2.8.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { effect } from '@sigx/reactivity';

import { OP, takeOps, resetOpQueue } from '../../src/op-queue';
import { MainThreadRef, resetWvidCounter } from '../../src/main-thread-ref';
import {
  ingestAvPublishes,
  resetBgAvBridge,
  bgAvSinkCount,
} from '../../src/animated-bridge';
import {
  useSharedValue,
  SharedValue,
} from '../../src/animated/shared-value';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
});

describe('useSharedValue', () => {
  it('returns a SharedValue (which is a MainThreadRef instance)', () => {
    const sv = useSharedValue(0);
    expect(sv).toBeInstanceOf(SharedValue);
    expect(sv).toBeInstanceOf(MainThreadRef);
  });

  it('seeds .current with the envelope and .value with the initial', () => {
    const sv = useSharedValue(42);
    expect(sv.current).toEqual({ value: 42 });
    expect(sv.value).toBe(42);
  });

  it('allocates a unique wvid per call', () => {
    const a = useSharedValue(0);
    const b = useSharedValue(0);
    expect(a._wvid).not.toBe(b._wvid);
  });

  it('pushes INIT_MT_REF and REGISTER_AV_BRIDGE ops', () => {
    const sv = useSharedValue(7);
    const ops = takeOps();

    // Format: [INIT_MT_REF, wvid, {value: 7}, REGISTER_AV_BRIDGE, wvid, 7]
    expect(ops).toEqual([
      OP.INIT_MT_REF, sv._wvid, { value: 7 },
      OP.REGISTER_AV_BRIDGE, sv._wvid, 7,
    ]);
  });

  it('registers a BG signal sink', () => {
    useSharedValue(0);
    expect(bgAvSinkCount()).toBe(1);
  });

  it('supports non-numeric T (e.g. string for color)', () => {
    const sv = useSharedValue<string>('#fff');
    expect(sv.current.value).toBe('#fff');
    sv.current.value = '#000';
    expect(sv.current.value).toBe('#000');
  });

  it('sv.value is reactive — sigx effect re-runs when the BG bridge ingests a publish', () => {
    const sv = useSharedValue(0);
    const seen: number[] = [];
    effect(() => {
      seen.push(sv.value);
    });

    expect(seen).toEqual([0]);

    // Simulate the MT bridge dispatching a Lynx.Sigx.AvPublish event whose
    // listener already called ingestAvPublishes — we call it directly.
    ingestAvPublishes([[sv._wvid, 30]]);
    expect(seen).toEqual([0, 30]);

    ingestAvPublishes([[sv._wvid, 31]]);
    expect(seen).toEqual([0, 30, 31]);
  });

  it('sv.value setter is read-only on BG (no-op at runtime)', () => {
    const sv = useSharedValue(10);
    // Setter doesn't throw, just warns — silence the warning for the test.
    const original = console.warn;
    console.warn = () => {};
    try {
      sv.value = 99;
    } finally {
      console.warn = original;
    }
    // The signal value is unchanged.
    expect(sv.value).toBe(10);
  });

  it('sv.current.value can be mutated locally on BG without crossing threads', () => {
    // The MT side reads from refMap[wvid].current.value, not from the BG
    // object directly, so BG-side mutations are inert (no MT publish). This
    // test pins behavior so a future regression is visible.
    const sv = useSharedValue(5);
    sv.current.value = 999;
    // No cross-thread effect — the BG signal still has the initial.
    expect(sv.value).toBe(5);
  });
});
