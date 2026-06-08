/**
 * Tests for the SharedValue bridge (originally Phase 2.5; primitive renamed
 * in Phase 2.8).
 *
 * Step 1 (protocol surface): op-codes + MT-side registration set / last-value
 * map. Step 2 (flush + publish): diffs registered SharedValues and dispatches
 * one batched `Lynx.Sigx.AvPublish` event per flush boundary.
 *
 * See PHASE-2.5-ANIMATED-BRIDGE-PLAN.md (repo root) for the full design.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OP } from '@sigx/lynx-runtime-internal';

import {
  applyOps,
  bridgedAvWvids,
  bridgedAvLastValues,
  resetMainThreadState,
} from '../src/ops-apply';
import {
  flushAvBridgePublishes,
  flushAnimatedStyleBindings,
  installAvBridgeFlushHook,
  animatedStyleBindingCount,
} from '../src/animated-bridge-mt';
import { lookupMapper, registerMapper } from '../src/animated-style-mappers';
import { elements } from '../src/element-registry';

interface FakeRef {
  current: { value: unknown };
  _wvid: number;
}

function seedRef(wvid: number, value: unknown): FakeRef {
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    { _refImpl: { _workletRefMap: Record<number, FakeRef> } } | undefined;
  const refMap = impl?._refImpl?._workletRefMap;
  if (!refMap) throw new Error('worklet runtime not initialized in test setup');
  const ref: FakeRef = { current: { value }, _wvid: wvid };
  refMap[wvid] = ref;
  return ref;
}

let dispatchEvent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // applyOps calls __FlushElementTree at the tail of every batch; stub the
  // PAPI globals it touches so the bridge tests can drive ops directly.
  vi.stubGlobal('__FlushElementTree', vi.fn());

  dispatchEvent = vi.fn();
  vi.stubGlobal('lynx', {
    SystemInfo: { lynxSdkVersion: '3.5.0' },
    getJSContext: () => ({ dispatchEvent, addEventListener: vi.fn() }),
  });
  // Provide a minimal lynxWorkletImpl so seedRef has somewhere to write.
  vi.stubGlobal('lynxWorkletImpl', {
    _workletMap: {},
    _refImpl: { _workletRefMap: {} as Record<number, FakeRef> },
  });

  resetMainThreadState();
});

describe('SharedValue bridge protocol surface', () => {
  it('REGISTER_AV_BRIDGE adds wvid to set and seeds last value', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 7, 42]);

    expect(bridgedAvWvids.has(7)).toBe(true);
    expect(bridgedAvLastValues.get(7)).toBe(42);
  });

  it('UNREGISTER_AV_BRIDGE removes both entries', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 7, 42]);
    applyOps([OP.UNREGISTER_AV_BRIDGE, 7]);

    expect(bridgedAvWvids.has(7)).toBe(false);
    expect(bridgedAvLastValues.has(7)).toBe(false);
  });

  it('multiple AVs coexist independently', () => {
    applyOps([
      OP.REGISTER_AV_BRIDGE, 1, 'first',
      OP.REGISTER_AV_BRIDGE, 2, 'second',
      OP.REGISTER_AV_BRIDGE, 3, 'third',
    ]);

    expect(bridgedAvWvids.size).toBe(3);
    expect(bridgedAvLastValues.get(1)).toBe('first');
    expect(bridgedAvLastValues.get(2)).toBe('second');
    expect(bridgedAvLastValues.get(3)).toBe('third');

    applyOps([OP.UNREGISTER_AV_BRIDGE, 2]);

    expect(bridgedAvWvids.size).toBe(2);
    expect(bridgedAvLastValues.has(2)).toBe(false);
    expect(bridgedAvLastValues.get(1)).toBe('first');
    expect(bridgedAvLastValues.get(3)).toBe('third');
  });

  it('resetMainThreadState clears bridge state', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 100]);
    expect(bridgedAvWvids.size).toBe(1);

    resetMainThreadState();

    expect(bridgedAvWvids.size).toBe(0);
    expect(bridgedAvLastValues.size).toBe(0);
  });
});

describe('SharedValue bridge — flushAvBridgePublishes (Step 2)', () => {
  it('no-ops when no AVs registered', () => {
    flushAvBridgePublishes();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('no-ops when registered AVs are unchanged since last publish', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    seedRef(1, 0);

    flushAvBridgePublishes();

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('dispatches a single batched event for a single changed AV', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const ref = seedRef(1, 0);

    ref.current.value = 30;
    flushAvBridgePublishes();

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const [event] = dispatchEvent.mock.calls[0]!;
    expect(event.type).toBe('Lynx.Sigx.AvPublish');
    expect(JSON.parse(event.data)).toEqual([[1, 30]]);
  });

  it('coalesces multiple changed AVs into one event', () => {
    applyOps([
      OP.REGISTER_AV_BRIDGE, 1, 0,
      OP.REGISTER_AV_BRIDGE, 2, 0,
      OP.REGISTER_AV_BRIDGE, 3, 0,
    ]);
    const r1 = seedRef(1, 0);
    const r2 = seedRef(2, 0);
    const r3 = seedRef(3, 0);

    r1.current.value = 10;
    r2.current.value = 20;
    r3.current.value = 30;
    flushAvBridgePublishes();

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const tuples = JSON.parse(dispatchEvent.mock.calls[0]![0].data) as Array<[number, unknown]>;
    expect(tuples.sort((a, b) => a[0] - b[0])).toEqual([[1, 10], [2, 20], [3, 30]]);
  });

  it('only publishes the AVs that actually changed', () => {
    applyOps([
      OP.REGISTER_AV_BRIDGE, 1, 0,
      OP.REGISTER_AV_BRIDGE, 2, 99,
    ]);
    const r1 = seedRef(1, 0);
    seedRef(2, 99); // unchanged

    r1.current.value = 5;
    flushAvBridgePublishes();

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const tuples = JSON.parse(dispatchEvent.mock.calls[0]![0].data) as Array<[number, unknown]>;
    expect(tuples).toEqual([[1, 5]]);
  });

  it('treats successive identical writes as no-ops on the second flush', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const r1 = seedRef(1, 0);

    r1.current.value = 7;
    flushAvBridgePublishes();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    // Second flush with no further mutation — no event.
    flushAvBridgePublishes();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    // Re-mutating to a new value re-publishes.
    r1.current.value = 8;
    flushAvBridgePublishes();
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('updates bridgedAvLastValues so subsequent diffs are correct', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const r1 = seedRef(1, 0);

    r1.current.value = 42;
    flushAvBridgePublishes();

    expect(bridgedAvLastValues.get(1)).toBe(42);
  });

  it('survives a missing ref entry (race between unregister and flush)', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 99, 'init']);
    // Don't seed the ref — simulate a stale registration.

    expect(() => flushAvBridgePublishes()).not.toThrow();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('animated-style mapper registry', () => {
  it('exposes built-in mappers via lookupMapper', () => {
    expect(typeof lookupMapper('translateX')).toBe('function');
    expect(typeof lookupMapper('translateY')).toBe('function');
    expect(typeof lookupMapper('translate')).toBe('function');
    expect(typeof lookupMapper('scale')).toBe('function');
    expect(typeof lookupMapper('scaleX')).toBe('function');
    expect(typeof lookupMapper('scaleY')).toBe('function');
    expect(typeof lookupMapper('opacity')).toBe('function');
    expect(typeof lookupMapper('rotate')).toBe('function');
    expect(typeof lookupMapper('width')).toBe('function');
    expect(typeof lookupMapper('height')).toBe('function');
  });

  it('returns undefined for unknown names', () => {
    expect(lookupMapper('does-not-exist')).toBeUndefined();
  });

  it('translateX honors the factor param', () => {
    const m = lookupMapper('translateX')!;
    expect(m(20, undefined)).toEqual({ transform: 'translateX(20px)' });
    expect(m(20, { factor: 0.5 })).toEqual({ transform: 'translateX(10px)' });
  });

  it('translate composes a 2D transform', () => {
    const m = lookupMapper('translate')!;
    expect(m({ x: 10, y: 20 }, { factorX: 2, factorY: 0.5 }))
      .toEqual({ transform: 'translate(20px, 10px)' });
  });

  it('opacity clamps to [0, 1]', () => {
    const m = lookupMapper('opacity')!;
    expect(m(-1, undefined)).toEqual({ opacity: '0' });
    expect(m(0.3, undefined)).toEqual({ opacity: '0.3' });
    expect(m(2, undefined)).toEqual({ opacity: '1' });
    expect(m(0.5, { factor: 2, offset: -0.25 })).toEqual({ opacity: '0.75' });
  });

  it('scaleX / scaleY emit single-axis transforms', () => {
    const sx = lookupMapper('scaleX')!;
    expect(sx(1, undefined)).toEqual({ transform: 'scaleX(1)' });
    expect(sx(1, { offset: 0.5 })).toEqual({ transform: 'scaleX(1.5)' });
    expect(sx(0, { inputRange: [0, 1], outputRange: [1, 3] }))
      .toEqual({ transform: 'scaleX(1)' });
    expect(sx(1, { inputRange: [0, 1], outputRange: [1, 3] }))
      .toEqual({ transform: 'scaleX(3)' });
    const sy = lookupMapper('scaleY')!;
    expect(sy(2, undefined)).toEqual({ transform: 'scaleY(2)' });
  });

  it('width / height emit layout styles in px', () => {
    const w = lookupMapper('width')!;
    expect(w(24, undefined)).toEqual({ width: '24px' });
    expect(w(0.5, { factor: 100 })).toEqual({ width: '50px' });
    expect(w(0.5, { inputRange: [0, 1], outputRange: [8, 24] }))
      .toEqual({ width: '16px' });
    const h = lookupMapper('height')!;
    expect(h(40, undefined)).toEqual({ height: '40px' });
  });

  it('registerMapper installs a custom mapper', () => {
    registerMapper('test-mapper', (v) => ({ width: `${v}px` }));
    const m = lookupMapper('test-mapper');
    expect(m).toBeTypeOf('function');
    expect(m!(42, undefined)).toEqual({ width: '42px' });
  });
});

describe('animated-style mapper range mapping', () => {
  it('translateY range-maps endpoints exactly', () => {
    const m = lookupMapper('translateY')!;
    expect(m(0, { inputRange: [0, 300], outputRange: [0, -150] }))
      .toEqual({ transform: 'translateY(0px)' });
    expect(m(300, { inputRange: [0, 300], outputRange: [0, -150] }))
      .toEqual({ transform: 'translateY(-150px)' });
  });

  it('translateY interpolates linearly mid-range', () => {
    const m = lookupMapper('translateY')!;
    expect(m(150, { inputRange: [0, 300], outputRange: [0, -150] }))
      .toEqual({ transform: 'translateY(-75px)' });
    expect(m(75, { inputRange: [0, 300], outputRange: [0, -150] }))
      .toEqual({ transform: 'translateY(-37.5px)' });
  });

  it('translateY clamps by default outside the range', () => {
    const m = lookupMapper('translateY')!;
    expect(m(-50, { inputRange: [0, 300], outputRange: [0, -150] }))
      .toEqual({ transform: 'translateY(0px)' });
    expect(m(500, { inputRange: [0, 300], outputRange: [0, -150] }))
      .toEqual({ transform: 'translateY(-150px)' });
  });

  it('translateY with extrapolate:identity extends beyond endpoints', () => {
    const m = lookupMapper('translateY')!;
    // Slope of segment [0,300] → [0,-150] is -0.5 per input unit.
    expect(m(-100, {
      inputRange: [0, 300], outputRange: [0, -150], extrapolate: 'identity',
    })).toEqual({ transform: 'translateY(50px)' });
    expect(m(400, {
      inputRange: [0, 300], outputRange: [0, -150], extrapolate: 'identity',
    })).toEqual({ transform: 'translateY(-200px)' });
  });

  it('multi-stop ranges select the correct segment', () => {
    const m = lookupMapper('translateY')!;
    const params = { inputRange: [0, 100, 200], outputRange: [0, 50, 0] };
    expect(m(0, params)).toEqual({ transform: 'translateY(0px)' });
    expect(m(50, params)).toEqual({ transform: 'translateY(25px)' });
    expect(m(100, params)).toEqual({ transform: 'translateY(50px)' });
    expect(m(150, params)).toEqual({ transform: 'translateY(25px)' });
    expect(m(200, params)).toEqual({ transform: 'translateY(0px)' });
  });

  it('translateX range-maps the same way as translateY', () => {
    const m = lookupMapper('translateX')!;
    expect(m(50, { inputRange: [0, 100], outputRange: [10, 30] }))
      .toEqual({ transform: 'translateX(20px)' });
  });

  it('opacity range-maps and clamps the output to [0,1]', () => {
    const m = lookupMapper('opacity')!;
    expect(m(0, { inputRange: [0, 150], outputRange: [1, 0] }))
      .toEqual({ opacity: '1' });
    expect(m(75, { inputRange: [0, 150], outputRange: [1, 0] }))
      .toEqual({ opacity: '0.5' });
    expect(m(150, { inputRange: [0, 150], outputRange: [1, 0] }))
      .toEqual({ opacity: '0' });
    // Output values outside [0,1] still get clamped.
    expect(m(50, {
      inputRange: [0, 100], outputRange: [2, -1], extrapolate: 'clamp',
    })).toEqual({ opacity: '0.5' });
  });

  it('scale range-maps to a multiplier', () => {
    const m = lookupMapper('scale')!;
    expect(m(0, { inputRange: [0, 200], outputRange: [1, 0.6] }))
      .toEqual({ transform: 'scale(1)' });
    expect(m(100, { inputRange: [0, 200], outputRange: [1, 0.6] }))
      .toEqual({ transform: 'scale(0.8)' });
    expect(m(200, { inputRange: [0, 200], outputRange: [1, 0.6] }))
      .toEqual({ transform: 'scale(0.6)' });
  });

  it('linear params still work after the range branch was added (back-compat)', () => {
    const tx = lookupMapper('translateX')!;
    expect(tx(20, { factor: 0.5 })).toEqual({ transform: 'translateX(10px)' });
    const op = lookupMapper('opacity')!;
    expect(op(0.5, { factor: 2, offset: -0.25 })).toEqual({ opacity: '0.75' });
  });
});

describe('flushAnimatedStyleBindings', () => {
  function seedElementRef(wvid: number): { setStyleProperties: ReturnType<typeof vi.fn> } {
    const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
      { _refImpl: { _workletRefMap: Record<number, FakeRef> } };
    const setStyleProperties = vi.fn();
    impl._refImpl._workletRefMap[wvid] = {
      current: { setStyleProperties } as unknown as { value: unknown },
      _wvid: wvid,
    };
    return { setStyleProperties };
  }

  it('no-ops when no bindings registered', () => {
    expect(() => flushAnimatedStyleBindings()).not.toThrow();
  });

  it('applies translateX mapper to bound element on first flush', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    seedRef(1, 0);
    const el = seedElementRef(2);
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'translateX', null]);

    flushAnimatedStyleBindings();

    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);
    expect(el.setStyleProperties).toHaveBeenCalledWith({ transform: 'translateX(0px)' });
  });

  it('reapplies on AV change but skips when value is unchanged', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const av = seedRef(1, 0);
    const el = seedElementRef(2);
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'translateX', null]);

    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);

    // No change — second flush should be a no-op.
    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);

    // Mutate AV — third flush reapplies.
    av.current.value = 30;
    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).toHaveBeenCalledTimes(2);
    expect(el.setStyleProperties).toHaveBeenLastCalledWith({ transform: 'translateX(30px)' });
  });

  it('honors mapper params (ghost-follower factor)', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const av = seedRef(1, 0);
    const el = seedElementRef(2);
    applyOps([
      OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'translateX', { factor: 0.5 },
    ]);

    av.current.value = 40;
    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).toHaveBeenLastCalledWith({ transform: 'translateX(20px)' });
  });

  it('skips silently when the element ref is null (not yet mounted)', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    seedRef(1, 0);
    // Don't seed element ref.
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 99, 1, 'translateX', null]);

    expect(() => flushAnimatedStyleBindings()).not.toThrow();
  });

  it('skips silently when the mapper name is not registered', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    seedRef(1, 0);
    const el = seedElementRef(2);
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'nope-not-a-mapper', null]);

    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).not.toHaveBeenCalled();
  });

  it('multiple transform bindings on the same element concat in registration order', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0, OP.REGISTER_AV_BRIDGE, 2, 0]);
    const av1 = seedRef(1, 0);
    const av2 = seedRef(2, 0);
    const el = seedElementRef(3);

    applyOps([
      OP.REGISTER_AV_STYLE_BINDING, 100, 3, 1, 'translateX', null,
      OP.REGISTER_AV_STYLE_BINDING, 101, 3, 2, 'translateY', null,
    ]);
    el.setStyleProperties.mockClear();

    av1.current.value = 50;
    av2.current.value = 30;
    flushAnimatedStyleBindings();

    // Single setStyleProperties call with concatenated transform.
    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);
    expect(el.setStyleProperties).toHaveBeenCalledWith({
      transform: 'translateX(50px) translateY(30px)',
    });
  });

  it('transform + non-transform on same element merge into one call', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0, OP.REGISTER_AV_BRIDGE, 2, 0]);
    const av1 = seedRef(1, 0);
    const av2 = seedRef(2, 0);
    const el = seedElementRef(3);

    applyOps([
      OP.REGISTER_AV_STYLE_BINDING, 100, 3, 1, 'translateX', null,
      OP.REGISTER_AV_STYLE_BINDING, 101, 3, 2, 'opacity', null,
    ]);
    el.setStyleProperties.mockClear();

    av1.current.value = 50;
    av2.current.value = 0.4;
    flushAnimatedStyleBindings();

    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);
    expect(el.setStyleProperties).toHaveBeenCalledWith({
      transform: 'translateX(50px)',
      opacity: '0.4',
    });
  });

  it('only ONE binding changing reapplies ALL bindings on the dirty element (preserves transform)', () => {
    // This is the showcase flicker case — translateX + translateY on the
    // same element. If only one AV ticks (e.g. small horizontal jitter
    // changes tx but not ty), the element MUST still get both halves of
    // the transform; otherwise the unchanged axis snaps to 0 every flush.
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0, OP.REGISTER_AV_BRIDGE, 2, 0]);
    const av1 = seedRef(1, 0);
    seedRef(2, 7); // av2 stays at 7 throughout
    const el = seedElementRef(3);

    applyOps([
      OP.REGISTER_AV_STYLE_BINDING, 100, 3, 1, 'translateX', null,
      OP.REGISTER_AV_STYLE_BINDING, 101, 3, 2, 'translateY', null,
    ]);
    el.setStyleProperties.mockClear();

    // Only av1 changes; av2 is unchanged.
    av1.current.value = 50;
    flushAnimatedStyleBindings();

    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);
    // translateY(7px) is still in the merged output even though av2
    // didn't change — the element is dirty because av1 changed, so all
    // bindings on it re-run.
    expect(el.setStyleProperties).toHaveBeenCalledWith({
      transform: 'translateX(50px) translateY(7px)',
    });
  });

  it('UNREGISTER_AV_STYLE_BINDING stops further applies', () => {
    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const av = seedRef(1, 0);
    const el = seedElementRef(2);
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'translateX', null]);

    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).toHaveBeenCalledTimes(1);
    expect(animatedStyleBindingCount()).toBe(1);

    applyOps([OP.UNREGISTER_AV_STYLE_BINDING, 100]);
    expect(animatedStyleBindingCount()).toBe(0);

    av.current.value = 100;
    flushAnimatedStyleBindings();
    expect(el.setStyleProperties).toHaveBeenCalledTimes(1); // no new call
  });

  it('resetMainThreadState clears bindings', () => {
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 1, 1, 1, 'translateX', null]);
    expect(animatedStyleBindingCount()).toBe(1);
    resetMainThreadState();
    expect(animatedStyleBindingCount()).toBe(0);
  });

  // Web (@lynx-js/web-core): the worklet-ref wrapper's setStyleProperties
  // throws because the underlying element has no setProperty, so per-frame
  // animated styles would silently freeze. The bridge falls back to the raw
  // MainThreadElement via __SetInlineStyles (resolved wvid → elementId →
  // element), the same PAPI the SET_STYLE op uses, which works on web.
  it('falls back to __SetInlineStyles on the raw element when the wrapper setStyleProperties throws (web)', () => {
    const setInlineCalls: Array<{ el: unknown; styles: unknown }> = [];
    vi.stubGlobal('__SetInlineStyles', (el: unknown, styles: unknown) => {
      setInlineCalls.push({ el, styles });
    });
    // SET_MT_REF delegates to the worklet runtime's updateWorkletRef.
    (globalThis as unknown as {
      lynxWorkletImpl: { _refImpl: { updateWorkletRef: unknown } };
    }).lynxWorkletImpl._refImpl.updateWorkletRef = vi.fn();

    const av = seedRef(1, 0);
    // Element worklet-ref whose setStyleProperties throws — the web-core case.
    const refMap = (globalThis as unknown as {
      lynxWorkletImpl: { _refImpl: { _workletRefMap: Record<number, FakeRef> } };
    }).lynxWorkletImpl._refImpl._workletRefMap;
    refMap[2] = {
      current: {
        setStyleProperties: () => {
          throw new Error('web: underlying element has no setProperty');
        },
      } as unknown as { value: unknown },
      _wvid: 2,
    };

    // Raw element + wvid → elementId mapping (populated by SET_MT_REF).
    const rawEl = { __brand: 'raw-200' };
    elements.set(200, rawEl as never);
    applyOps([OP.SET_MT_REF, 200, 2]);

    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'translateX', null]);
    setInlineCalls.length = 0; // ignore the initial apply from REGISTER's flush

    av.current.value = 30;
    flushAnimatedStyleBindings();

    expect(setInlineCalls).toEqual([
      { el: rawEl, styles: { transform: 'translateX(30px)' } },
    ]);
  });

  it('does NOT use the raw fallback when the wrapper setStyleProperties succeeds (native unchanged)', () => {
    const setInline = vi.fn();
    vi.stubGlobal('__SetInlineStyles', setInline);

    const av = seedRef(1, 0);
    const el = seedElementRef(2); // working setStyleProperties
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 100, 2, 1, 'translateX', null]);

    av.current.value = 30;
    flushAnimatedStyleBindings();

    expect(el.setStyleProperties).toHaveBeenLastCalledWith({ transform: 'translateX(30px)' });
    expect(setInline).not.toHaveBeenCalled();
  });
});

describe('installAvBridgeFlushHook', () => {
  // The hook wraps __FlushElementTree once; if entry-main.ts already ran in
  // an earlier test it will have set the install symbol on globalThis. Clear
  // the symbol so each test installs a fresh wrapper around its own stub.
  const INSTALLED = Symbol.for('sigx.avBridgeFlushHookInstalled');

  it('wraps __FlushElementTree to call flushAvBridgePublishes first', () => {
    const order: string[] = [];
    delete (globalThis as Record<symbol, unknown>)[INSTALLED];
    vi.stubGlobal('__FlushElementTree', vi.fn(() => order.push('flush')));

    installAvBridgeFlushHook();

    applyOps([OP.REGISTER_AV_BRIDGE, 1, 0]);
    const r1 = seedRef(1, 0);
    r1.current.value = 11;

    // applyOps also flushes (wrapped) — clear bookkeeping so the explicit
    // tree flush below tests the wrapper in isolation.
    order.length = 0;
    dispatchEvent.mockClear();

    // Invoke the wrapped flush directly — simulating upstream's
    // setStyleProperties microtask firing __FlushElementTree.
    (globalThis as { __FlushElementTree?: () => void }).__FlushElementTree?.();

    // Tree flush should publish the diff first, then call the original flush.
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const tuples = JSON.parse(dispatchEvent.mock.calls[0]![0].data) as Array<[number, unknown]>;
    expect(tuples).toEqual([[1, 11]]);
    expect(order).toEqual(['flush']);
  });

  it('is idempotent — second install is a no-op', () => {
    delete (globalThis as Record<symbol, unknown>)[INSTALLED];
    const original = vi.fn();
    vi.stubGlobal('__FlushElementTree', original);

    installAvBridgeFlushHook();
    const wrapped = (globalThis as { __FlushElementTree?: unknown }).__FlushElementTree;
    installAvBridgeFlushHook();

    expect((globalThis as { __FlushElementTree?: unknown }).__FlushElementTree).toBe(wrapped);
  });

  it('skips install if __FlushElementTree is undefined', () => {
    delete (globalThis as Record<symbol, unknown>)[INSTALLED];
    vi.stubGlobal('__FlushElementTree', undefined);

    expect(() => installAvBridgeFlushHook()).not.toThrow();
  });
});
