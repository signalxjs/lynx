/**
 * #710 — derived SharedValues. A derived SV folds one or more source SVs
 * through a NAMED reducer on the MT, recomputed each flush a source changed,
 * BEFORE the style-binding pass, and (being an auto-flush bridge) published to
 * BG. These tests drive the ops + flush directly against the fake worklet ref
 * map, the same pattern as animated-bridge.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OP } from '@sigx/lynx-runtime-internal';

import { applyOps, resetMainThreadState } from '../src/ops-apply';
import {
  flushDerivedValues,
  derivedValueCount,
  registerReducer,
  lookupReducer,
  resetReducers,
} from '../src/derived-values-mt';
import {
  flushAnimatedStyleBindings,
  installAvBridgeFlushHook,
  resetDuplicateTransformWarnings,
} from '../src/animated-bridge-mt';

interface FakeRef {
  current: { value: unknown };
}

function seedEnvelope(wvid: number, value: unknown): FakeRef {
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    { _refImpl: { _workletRefMap: Record<number, FakeRef> } } | undefined;
  const refMap = impl?._refImpl?._workletRefMap;
  if (!refMap) throw new Error('worklet runtime not initialized');
  const ref: FakeRef = { current: { value } };
  refMap[wvid] = ref;
  return ref;
}

function read(wvid: number): unknown {
  const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
    { _refImpl: { _workletRefMap: Record<number, FakeRef> } };
  return impl._refImpl._workletRefMap[wvid]?.current.value;
}

beforeEach(() => {
  vi.stubGlobal('__FlushElementTree', vi.fn());
  vi.stubGlobal('lynx', {
    SystemInfo: { lynxSdkVersion: '3.5.0' },
    getJSContext: () => ({ dispatchEvent: vi.fn(), addEventListener: vi.fn() }),
  });
  vi.stubGlobal('lynxWorkletImpl', {
    _workletMap: {},
    _refImpl: { _workletRefMap: {} as Record<number, FakeRef> },
  });
  resetMainThreadState();
  resetReducers();
  resetDuplicateTransformWarnings();
});

describe('derived-value registry (#710)', () => {
  it('REGISTER/UNREGISTER_AV_DERIVED track the binding', () => {
    seedEnvelope(10, 0);
    seedEnvelope(1, 5);
    seedEnvelope(2, 8);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'max', null, [1, 2]]);
    expect(derivedValueCount()).toBe(1);
    applyOps([OP.UNREGISTER_AV_DERIVED, 10]);
    expect(derivedValueCount()).toBe(0);
  });

  it('max folds sources; the first flush always computes', () => {
    seedEnvelope(10, 0);
    seedEnvelope(1, 5);
    seedEnvelope(2, 8);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'max', null, [1, 2]]);
    flushDerivedValues();
    expect(read(10)).toBe(8);
  });

  it('recomputes only when a source changed', () => {
    seedEnvelope(10, 0);
    const a = seedEnvelope(1, 5);
    const b = seedEnvelope(2, 8);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'max', null, [1, 2]]);
    flushDerivedValues();
    expect(read(10)).toBe(8);
    // Source a rises above b — max follows.
    a.current.value = 20;
    flushDerivedValues();
    expect(read(10)).toBe(20);
    // No change — value holds.
    flushDerivedValues();
    expect(read(10)).toBe(20);
    b.current.value = 3;
    flushDerivedValues();
    expect(read(10)).toBe(20);
  });

  it('min / sum / scale built-ins', () => {
    seedEnvelope(20, 0); seedEnvelope(21, 0); seedEnvelope(22, 0);
    seedEnvelope(1, 5); seedEnvelope(2, 8); seedEnvelope(3, 2);
    applyOps([OP.REGISTER_AV_DERIVED, 20, 'min', null, [1, 2, 3]]);
    applyOps([OP.REGISTER_AV_DERIVED, 21, 'sum', null, [1, 2, 3]]);
    applyOps([OP.REGISTER_AV_DERIVED, 22, 'scale', { factor: 10, offset: 1 }, [1]]);
    flushDerivedValues();
    expect(read(20)).toBe(2);
    expect(read(21)).toBe(15);
    expect(read(22)).toBe(51); // 5 * 10 + 1
  });

  it('re-registering the same derivedWvid swaps reducer/params, keeps identity', () => {
    seedEnvelope(10, 0);
    seedEnvelope(1, 4);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'scale', { factor: 2 }, [1]]);
    flushDerivedValues();
    expect(read(10)).toBe(8);
    // Reactive factor rebind — same derivedWvid, new factor.
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'scale', { factor: 3 }, [1]]);
    flushDerivedValues();
    expect(read(10)).toBe(12);
    expect(derivedValueCount()).toBe(1);
  });

  it('the max derived feeds a style binding the SAME flush (order: derived before bindings)', () => {
    installAvBridgeFlushHook();
    // element el(30), sources kbLift(1)=100, sheetH(2)=250, derived(10)=max
    seedEnvelope(30, null);
    seedEnvelope(10, 0);
    seedEnvelope(1, 100);
    seedEnvelope(2, 250);
    const applied: Array<Record<string, string | number>> = [];
    const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
      { _refImpl: { _workletRefMap: Record<number, { current: unknown }> } };
    impl._refImpl._workletRefMap[30] = {
      current: { setStyleProperties: (s: Record<string, string | number>) => { applied.push(s); } },
    } as unknown as { current: unknown };

    applyOps([OP.REGISTER_AV_DERIVED, 10, 'max', null, [1, 2]]);
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 1, 30, 10, 'translateY', { factor: -1 }]);

    // One wrapped flush: derived computes 250, then the binding maps it.
    (globalThis as unknown as { __FlushElementTree: () => void }).__FlushElementTree();
    expect(applied.at(-1)).toEqual({ transform: 'translateY(-250px)' });

    // Sheet grows past — the bound bar follows in one flush.
    (impl._refImpl._workletRefMap[2] as unknown as { current: { value: number } }).current.value = 400;
    (globalThis as unknown as { __FlushElementTree: () => void }).__FlushElementTree();
    expect(applied.at(-1)).toEqual({ transform: 'translateY(-400px)' });
  });

  it('unknown reducer name is a silent no-op', () => {
    seedEnvelope(10, 7);
    seedEnvelope(1, 5);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'nope', null, [1]]);
    flushDerivedValues();
    expect(read(10)).toBe(7); // unchanged
  });

  it('custom reducer via registerReducer', () => {
    registerReducer('avg', (vs) => vs.reduce((a, b) => a + b, 0) / vs.length);
    expect(lookupReducer('avg')).toBeTypeOf('function');
    seedEnvelope(10, 0);
    seedEnvelope(1, 10); seedEnvelope(2, 20);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'avg', null, [1, 2]]);
    flushDerivedValues();
    expect(read(10)).toBe(15);
  });

  it('missing source envelope skips (race with unregister)', () => {
    seedEnvelope(10, 42);
    // source 1 never seeded
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'max', null, [1]]);
    flushDerivedValues();
    expect(read(10)).toBe(42); // unchanged, no throw
  });

  it('resetMainThreadState clears derived bindings', () => {
    seedEnvelope(10, 0); seedEnvelope(1, 1);
    applyOps([OP.REGISTER_AV_DERIVED, 10, 'max', null, [1]]);
    expect(derivedValueCount()).toBe(1);
    resetMainThreadState();
    expect(derivedValueCount()).toBe(0);
  });
});

describe('duplicate-transform footgun warning (#710)', () => {
  it('warns once when two bindings on one element both emit translateY', () => {
    installAvBridgeFlushHook();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedEnvelope(40, null);
    seedEnvelope(1, 10);
    seedEnvelope(2, 20);
    const impl = (globalThis as Record<string, unknown>)['lynxWorkletImpl'] as
      { _refImpl: { _workletRefMap: Record<number, { current: unknown }> } };
    impl._refImpl._workletRefMap[40] = {
      current: { setStyleProperties: () => {} },
    } as unknown as { current: unknown };

    applyOps([OP.REGISTER_AV_STYLE_BINDING, 1, 40, 1, 'translateY', { factor: 1 }]);
    applyOps([OP.REGISTER_AV_STYLE_BINDING, 2, 40, 2, 'translateY', { factor: 1 }]);
    (globalThis as unknown as { __FlushElementTree: () => void }).__FlushElementTree();

    const dupWarns = warn.mock.calls.filter((c) => String(c[0]).includes('useDerivedValue'));
    expect(dupWarns.length).toBe(1);
    warn.mockRestore();
  });
});
