/**
 * Web gesture recognizer (`web-gesture-mt.ts`).
 *
 * On web (`@lynx-js/web-core`, no gesture arena) the gesture op routes here. The
 * recognizer attaches native pointer listeners on the element (a real DOM node)
 * and invokes the gesture's worklet callbacks via `globalThis.runWorklet`. These
 * tests drive a fake element whose `addEventListener` captures the handlers, then
 * fire synthetic pointer events at them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import {
  registerWebGesture,
  unregisterWebGesture,
  resetWebGestures,
} from '../src/web-gesture-mt';
import { applyOps, resetMainThreadState } from '../src/ops-apply';
import { elements } from '../src/element-registry';

const PAN = 0;
const TAP = 3;
const LONGPRESS = 4;

let runCalls: Array<{ wkltId: unknown; event: { params: { pageX: number; pageY: number } } }>;

interface FakeEl {
  listeners: Record<string, (e: unknown) => void>;
  style: { touchAction: string };
  addEventListener: (t: string, fn: (e: unknown) => void) => void;
  removeEventListener: (t: string) => void;
  setPointerCapture: ReturnType<typeof vi.fn>;
  fire: (type: string, x: number, y: number) => void;
}

function makeEl(): FakeEl {
  const listeners: Record<string, (e: unknown) => void> = {};
  return {
    listeners,
    style: { touchAction: '' },
    addEventListener: (t, fn) => {
      listeners[t] = fn;
    },
    removeEventListener: (t) => {
      delete listeners[t];
    },
    setPointerCapture: vi.fn(),
    fire(type, x, y) {
      listeners[type]?.({ type, clientX: x, clientY: y, pointerId: 1 });
    },
  };
}

function reg(
  el: FakeEl,
  wvid: number,
  gid: number,
  type: number,
  callbacks: { name: string; callback: { _wkltId: string } }[],
  config?: Record<string, unknown>,
): void {
  registerWebGesture(el as never, wvid, gid, type, { callbacks, config });
}

const fired = (): unknown[] => runCalls.map((c) => c.wkltId);

beforeEach(() => {
  resetWebGestures();
  runCalls = [];
  vi.stubGlobal('runWorklet', (ctx: { _wkltId: unknown }, args: unknown[]) => {
    runCalls.push({ wkltId: ctx._wkltId, event: args[0] as never });
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetWebGestures();
});

describe('web gesture recognizer (pointer listeners)', () => {
  it('attaches the four pointer listeners on the first gesture', () => {
    const el = makeEl();
    reg(el, 5, 1, TAP, []);
    expect(Object.keys(el.listeners).sort()).toEqual([
      'pointercancel',
      'pointerdown',
      'pointermove',
      'pointerup',
    ]);
  });

  it('Tap: onBegin on down, then onStart + onEnd on a near-still up', () => {
    const el = makeEl();
    reg(el, 5, 1, TAP, [
      { name: 'onBegin', callback: { _wkltId: 'begin' } },
      { name: 'onStart', callback: { _wkltId: 'start' } },
      { name: 'onEnd', callback: { _wkltId: 'end' } },
    ]);
    el.fire('pointerdown', 100, 100);
    el.fire('pointerup', 102, 101); // within maxDistance
    expect(fired()).toEqual(['begin', 'start', 'end']);
  });

  it('Tap: a drag past maxDistance suppresses onStart but still ends', () => {
    const el = makeEl();
    reg(el, 5, 1, TAP, [
      { name: 'onStart', callback: { _wkltId: 'start' } },
      { name: 'onEnd', callback: { _wkltId: 'end' } },
    ]);
    el.fire('pointerdown', 100, 100);
    el.fire('pointermove', 200, 100);
    el.fire('pointerup', 200, 100);
    expect(fired()).not.toContain('start');
    expect(fired()).toContain('end');
  });

  it('LongPress: onStart fires after minDuration on a still press', () => {
    const el = makeEl();
    reg(el, 5, 1, LONGPRESS, [{ name: 'onStart', callback: { _wkltId: 'lp' } }], {
      minDuration: 500,
    });
    el.fire('pointerdown', 50, 50);
    expect(fired()).not.toContain('lp');
    vi.advanceTimersByTime(500);
    expect(fired()).toContain('lp');
  });

  it('LongPress: moving past tolerance cancels the timer', () => {
    const el = makeEl();
    reg(el, 5, 1, LONGPRESS, [{ name: 'onStart', callback: { _wkltId: 'lp' } }], {
      minDuration: 500,
      maxDistance: 10,
    });
    el.fire('pointerdown', 50, 50);
    el.fire('pointermove', 100, 50); // 50px > 10px tolerance
    vi.advanceTimersByTime(500);
    expect(fired()).not.toContain('lp');
  });

  it('Pan: onStart once, onUpdate per move (carrying pageX), onEnd on up', () => {
    const el = makeEl();
    reg(
      el,
      5,
      1,
      PAN,
      [
        { name: 'onBegin', callback: { _wkltId: 'b' } },
        { name: 'onStart', callback: { _wkltId: 's' } },
        { name: 'onUpdate', callback: { _wkltId: 'u' } },
        { name: 'onEnd', callback: { _wkltId: 'e' } },
      ],
      { minDistance: 0 },
    );
    el.fire('pointerdown', 0, 0);
    el.fire('pointermove', 5, 0);
    el.fire('pointermove', 12, 0);
    el.fire('pointerup', 12, 0);
    const f = fired();
    expect(f[0]).toBe('b');
    expect(f.filter((x) => x === 's')).toHaveLength(1); // onStart once
    expect(f.filter((x) => x === 'u')).toHaveLength(2); // onUpdate per move
    expect(f[f.length - 1]).toBe('e');
    expect(runCalls.find((c) => c.wkltId === 'u')!.event.params.pageX).toBe(5);
  });

  it('Pan sets touch-action:none and restores it on teardown', () => {
    const el = makeEl();
    el.style.touchAction = 'auto';
    reg(el, 5, 1, PAN, []);
    expect(el.style.touchAction).toBe('none');
    unregisterWebGesture(5, 1);
    expect(el.style.touchAction).toBe('auto');
  });

  it('composed Tap+LongPress: a quick tap emits Tap.onStart and ends every gesture', () => {
    // Pressable's shape — visual reset lives in LongPress.onEnd.
    const el = makeEl();
    reg(el, 5, 1, TAP, [{ name: 'onStart', callback: { _wkltId: 'tap-start' } }]);
    reg(el, 5, 2, LONGPRESS, [{ name: 'onEnd', callback: { _wkltId: 'lp-end' } }], {
      minDuration: 500,
    });
    el.fire('pointerdown', 0, 0);
    el.fire('pointerup', 1, 0);
    expect(fired()).toContain('tap-start');
    expect(fired()).toContain('lp-end');
  });

  it('unregister removes the listeners when the last gesture goes', () => {
    const el = makeEl();
    reg(el, 5, 1, TAP, []);
    unregisterWebGesture(5, 1);
    expect(Object.keys(el.listeners)).toHaveLength(0);
  });
});

describe('worklet setStyleProperties web fallback (SET_MT_REF)', () => {
  it('patches the worklet ref so setStyleProperties falls back to __SetInlineStyles on web', () => {
    resetMainThreadState();
    const setInline = vi.fn();
    vi.stubGlobal('__SetInlineStyles', setInline);
    vi.stubGlobal('__FlushElementTree', vi.fn());
    vi.stubGlobal('__SetGestureDetector', undefined); // web signal

    const wrapper: { setStyleProperties: (s: Record<string, string | number>) => void } = {
      setStyleProperties: () => {
        throw new Error('web: element has no setProperty');
      },
    };
    const refMap: Record<number, { current: unknown; _wvid: number }> = {};
    vi.stubGlobal('lynxWorkletImpl', {
      _workletMap: {},
      _refImpl: {
        _workletRefMap: refMap,
        updateWorkletRef: (ref: { _wvid: number }) => {
          refMap[ref._wvid] = { current: wrapper, _wvid: ref._wvid };
        },
      },
    });

    const rawEl = { __brand: 'raw-100' };
    elements.set(100, rawEl as never);
    applyOps([OP.SET_MT_REF, 100, 7]);

    wrapper.setStyleProperties({ opacity: 0.5 });
    expect(setInline).toHaveBeenCalledWith(rawEl, { opacity: 0.5 });
    // The wrapper's debounced flush schedules a `__FlushElementTree()`
    // microtask; the top-level afterEach unstubs globals only after it runs.
  });
});
