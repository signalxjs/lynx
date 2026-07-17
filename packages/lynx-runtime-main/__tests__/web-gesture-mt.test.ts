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
  fire: (
    type: string,
    x: number,
    y: number,
    pageX?: number,
    pageY?: number,
    pointerId?: number,
  ) => void;
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
    fire(type, x, y, pageX, pageY, pointerId = 1) {
      listeners[type]?.({ type, clientX: x, clientY: y, pageX, pageY, pointerId });
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

  it('restores touch-action when the Pan is removed but other gestures remain', () => {
    const el = makeEl();
    el.style.touchAction = 'pan-y';
    reg(el, 5, 1, PAN, []); // sets touch-action:none
    reg(el, 5, 2, TAP, []); // Tap also on the element
    expect(el.style.touchAction).toBe('none');
    unregisterWebGesture(5, 1); // remove the Pan; Tap stays
    expect(el.style.touchAction).toBe('pan-y'); // restored despite the Tap
    expect(Object.keys(el.listeners).length).toBeGreaterThan(0); // listeners stay
  });

  it('Pan onUpdate carries the event pageX (scroll-offset aware), not clientX', () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, [{ name: 'onUpdate', callback: { _wkltId: 'u' } }], {
      minDistance: 0,
    });
    el.fire('pointerdown', 0, 0, 100, 200); // clientX 0, pageX 100
    el.fire('pointermove', 5, 0, 105, 200);
    expect(runCalls.find((c) => c.wkltId === 'u')!.event.params.pageX).toBe(105);
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

describe('multi-pointer tracking (per-pointerId)', () => {
  it('a second pointerdown does not reset the press — pan deltas keep the original start', () => {
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
      ],
      { minDistance: 0 },
    );
    el.fire('pointerdown', 0, 0, 0, 0, 1);
    el.fire('pointermove', 20, 0, 20, 0, 1); // pan started
    el.fire('pointerdown', 100, 100, 100, 100, 2); // second finger lands
    el.fire('pointermove', 40, 0, 40, 0, 1); // primary keeps driving
    const f = fired();
    expect(f.filter((x) => x === 'b')).toHaveLength(1); // onBegin NOT re-fired
    expect(f.filter((x) => x === 's')).toHaveLength(1); // pan not restarted
    expect(f.filter((x) => x === 'u')).toHaveLength(2); // both primary moves
    expect(runCalls.at(-1)!.event.params.pageX).toBe(40);
  });

  it('a second pointerdown cancels a pending long-press', () => {
    const el = makeEl();
    reg(el, 5, 1, LONGPRESS, [{ name: 'onStart', callback: { _wkltId: 'lp' } }], {
      minDuration: 500,
    });
    el.fire('pointerdown', 50, 50, undefined, undefined, 1);
    el.fire('pointerdown', 60, 60, undefined, undefined, 2);
    vi.advanceTimersByTime(500);
    expect(fired()).not.toContain('lp');
  });

  it('tap is suppressed after two-finger contact, but onEnd still fires', () => {
    const el = makeEl();
    reg(el, 5, 1, TAP, [
      { name: 'onStart', callback: { _wkltId: 'tap-start' } },
      { name: 'onEnd', callback: { _wkltId: 'tap-end' } },
    ]);
    el.fire('pointerdown', 100, 100, undefined, undefined, 1);
    el.fire('pointerdown', 110, 100, undefined, undefined, 2);
    el.fire('pointerup', 110, 100, undefined, undefined, 2);
    el.fire('pointerup', 101, 100, undefined, undefined, 1); // near-still primary up
    expect(fired()).not.toContain('tap-start');
    expect(fired()).toContain('tap-end');
  });

  it("a secondary pointerup does not end the press; the primary's does", () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, [{ name: 'onEnd', callback: { _wkltId: 'e' } }], { minDistance: 0 });
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 50, 50, undefined, undefined, 2);
    el.fire('pointerup', 50, 50, undefined, undefined, 2);
    expect(fired()).not.toContain('e');
    el.fire('pointerup', 0, 0, undefined, undefined, 1);
    expect(fired()).toContain('e');
  });

  it('secondary pointer moves do not drive pan', () => {
    const el = makeEl();
    reg(
      el,
      5,
      1,
      PAN,
      [
        { name: 'onStart', callback: { _wkltId: 's' } },
        { name: 'onUpdate', callback: { _wkltId: 'u' } },
      ],
      { minDistance: 0 },
    );
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 10, 10, undefined, undefined, 2);
    el.fire('pointermove', 60, 60, undefined, undefined, 2); // secondary drags
    expect(fired()).not.toContain('s');
    expect(fired()).not.toContain('u');
  });

  it('no new press starts while a stale secondary is still down after the press ended', () => {
    const el = makeEl();
    reg(el, 5, 1, TAP, [{ name: 'onBegin', callback: { _wkltId: 'begin' } }]);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 10, 10, undefined, undefined, 2);
    el.fire('pointerup', 0, 0, undefined, undefined, 1); // primary lifts — press over
    runCalls = [];
    el.fire('pointerdown', 20, 20, undefined, undefined, 3); // finger 2 still down
    expect(fired()).not.toContain('begin');
    el.fire('pointerup', 10, 10, undefined, undefined, 2);
    el.fire('pointerup', 20, 20, undefined, undefined, 3);
    el.fire('pointerdown', 30, 30, undefined, undefined, 4); // all lifted — fresh press
    expect(fired()).toContain('begin');
  });

  it('duplicate downs with no pointerId (both normalize to 0) do not clobber the press', () => {
    // Hosts that omit pointerId: a repeated down must not reset the primary's
    // start coords nor flip the press to multi-touch.
    const el = makeEl();
    const fireNoId = (type: string, x: number, y: number) =>
      el.listeners[type]?.({ type, clientX: x, clientY: y });
    reg(
      el,
      5,
      1,
      PAN,
      [
        { name: 'onStart', callback: { _wkltId: 's' } },
        { name: 'onUpdate', callback: { _wkltId: 'u' } },
      ],
      { minDistance: 15 },
    );
    reg(el, 5, 2, TAP, [{ name: 'onStart', callback: { _wkltId: 'tap' } }]);
    fireNoId('pointerdown', 0, 0);
    fireNoId('pointerdown', 100, 100); // duplicate down, id also 0 — ignored
    fireNoId('pointermove', 20, 0); // 20px from ORIGINAL start > minDistance 15
    expect(fired()).toContain('s'); // pan measured from (0,0), not (100,100)
    fireNoId('pointerup', 20, 0);

    // And a plain tap still works (duplicate down didn't set multiTouch).
    runCalls = [];
    fireNoId('pointerdown', 0, 0);
    fireNoId('pointerdown', 2, 0);
    fireNoId('pointerup', 2, 0);
    expect(fired()).toContain('tap');
  });

  it('both pointers get pointer capture', () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, []);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 10, 10, undefined, undefined, 2);
    expect(el.setPointerCapture).toHaveBeenCalledWith(1);
    expect(el.setPointerCapture).toHaveBeenCalledWith(2);
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
