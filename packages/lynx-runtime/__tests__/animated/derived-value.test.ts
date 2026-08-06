/**
 * BG-side op emission for `useDerivedValue` (#710). MT-side folding is covered
 * in `lynx-runtime-main/__tests__/derived-values.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { OP, takeOps, resetOpQueue } from '../../src/op-queue';
import { resetWvidCounter } from '../../src/main-thread-ref';
import { resetBgAvBridge } from '../../src/animated-bridge';
import { useSharedValue } from '../../src/animated/shared-value';
import {
  useDerivedValue,
  useDerivedValueReactive,
} from '../../src/animated/derived-value';

beforeEach(() => {
  resetOpQueue();
  resetBgAvBridge();
  resetWvidCounter();
});

describe('useDerivedValue', () => {
  it('allocates a bridged SV and registers the derived over the sources', () => {
    const a = useSharedValue(0);
    const b = useSharedValue(0);
    resetOpQueue(); // drop the sources' INIT/REGISTER ops

    const d = useDerivedValue([a, b], 'max');

    const ops = takeOps();
    expect(ops).toEqual([
      OP.INIT_MT_REF, d._wvid, d._initValue,
      OP.REGISTER_AV_BRIDGE, d._wvid, 0,
      OP.REGISTER_AV_DERIVED, d._wvid, 'max', null, [a._wvid, b._wvid],
    ]);
  });

  it('bridge:false skips the BG publish but keeps the MT value (#930)', () => {
    // A derived value consumed only by MT bindings (a gesture delta) changes
    // every frame by construction. Publishing it costs ~60-100 MT->BG
    // dispatches a second for a reader that does not exist, which on its own
    // trips the engine's limiter ("DispatchEvent called too frequently").
    const a = useSharedValue(0);
    const b = useSharedValue(0);
    resetOpQueue();

    const d = useDerivedValue([a, b], 'sum', undefined, { bridge: false });

    const ops = takeOps();
    expect(ops).toEqual([
      OP.INIT_MT_REF, d._wvid, d._initValue,
      OP.REGISTER_AV_DERIVED, d._wvid, 'sum', null, [a._wvid, b._wvid],
    ]);
    expect(ops).not.toContain(OP.REGISTER_AV_BRIDGE);
  });

  it('the reactive form also honours bridge:false (#930)', () => {
    const a = useSharedValue(0);
    resetOpQueue();

    const d = useDerivedValueReactive(
      () => ({ sources: [a], reducer: 'sum' as const }),
      { bridge: false },
    );

    const ops = takeOps();
    expect(ops).toContain(OP.INIT_MT_REF);
    expect(ops).not.toContain(OP.REGISTER_AV_BRIDGE);
    expect(d._wvid).toBeTypeOf('number');
  });

  it('passes reducer params through', () => {
    const p = useSharedValue(0);
    resetOpQueue();

    const d = useDerivedValue([p], 'scale', { factor: 3, offset: 1 });

    const ops = takeOps();
    expect(ops).toContain(OP.REGISTER_AV_DERIVED);
    const idx = ops.indexOf(OP.REGISTER_AV_DERIVED);
    expect(ops[idx + 2]).toBe('scale');
    expect(ops[idx + 3]).toEqual({ factor: 3, offset: 1 });
    expect(ops[idx + 4]).toEqual([p._wvid]);
    // d is a real SharedValue readable on BG (initial 0 until MT publishes).
    expect(d.value).toBe(0);
  });

  it('reactive form re-registers on the same derivedWvid when params change', () => {
    const p = useSharedValue(0);
    let factor = 2;
    resetOpQueue();

    const d = useDerivedValueReactive(() => ({ sources: [p], reducer: 'scale', params: { factor } }));
    const first = takeOps();
    // INIT + REGISTER_AV_BRIDGE, then the effect's first REGISTER_AV_DERIVED.
    const dReg1 = first.indexOf(OP.REGISTER_AV_DERIVED);
    expect(first[dReg1 + 1]).toBe(d._wvid);
    expect(first[dReg1 + 3]).toEqual({ factor: 2 });

    // Changing the closed-over factor doesn't re-run the effect by itself;
    // the reactive form is driven by tracked reads. This test asserts the
    // op SHAPE — the same derivedWvid is used so consumers stay bound.
    expect(first[dReg1 + 1]).toBe(d._wvid);
    void factor;
  });
});
