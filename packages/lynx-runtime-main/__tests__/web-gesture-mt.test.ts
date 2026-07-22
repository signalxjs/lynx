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
  relationMap?: { waitFor?: number[]; simultaneous?: number[]; continueWith?: number[] },
): void {
  registerWebGesture(el as never, wvid, gid, type, { callbacks, config }, relationMap);
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

  // #759 — `<Pressable longPressDuration={0}>` disables long-press by pushing
  // `minDuration` to Number.MAX_SAFE_INTEGER so the timer never elapses. That
  // works on native, but `setTimeout` coerces its delay to a signed 32-bit int,
  // so on web the delay wrapped to <= 0 and LongPress fired on the next tick:
  // `lpFired` then disqualified the tap AND short-circuited the onEnd press
  // fallback, so `press` never emitted. Every daisyui/heroui control built on
  // Pressable was inert on web.
  describe('LongPress: a never-elapsing minDuration (#759)', () => {
    it('does not arm a timer whose delay setTimeout cannot represent', () => {
      const el = makeEl();
      const spy = vi.spyOn(globalThis, 'setTimeout');
      reg(el, 5, 1, LONGPRESS, [{ name: 'onStart', callback: { _wkltId: 'lp' } }], {
        minDuration: Number.MAX_SAFE_INTEGER,
      });
      el.fire('pointerdown', 50, 50);
      const overflowing = spy.mock.calls.filter(
        ([, delay]) => typeof delay === 'number' && delay > 2147483647,
      );
      expect(overflowing).toEqual([]);
      spy.mockRestore();
    });

    it('still emits the tap when the browser clamps the delay to 0', () => {
      const el = makeEl();
      // Mirror the browser: a delay past the 32-bit ceiling wraps to "now".
      const realSetTimeout = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        fn: () => void,
        delay?: number,
        ...rest: unknown[]
      ) =>
        (realSetTimeout as never as (f: () => void, d: number, ...r: unknown[]) => number)(
          fn,
          typeof delay === 'number' && delay > 2147483647 ? 0 : (delay ?? 0),
          ...rest,
        )) as never);

      reg(el, 5, 1, TAP, [{ name: 'onStart', callback: { _wkltId: 'tap' } }]);
      reg(el, 5, 2, LONGPRESS, [{ name: 'onStart', callback: { _wkltId: 'lp' } }], {
        minDuration: Number.MAX_SAFE_INTEGER,
      });

      el.fire('pointerdown', 50, 50);
      vi.advanceTimersByTime(1); // the clamped timer would fire here
      el.fire('pointerup', 51, 50);

      expect(fired()).not.toContain('lp');
      expect(fired()).toContain('tap');
    });
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

describe('axis-aware touch-action derivation', () => {
  const FLING = 1;
  const PINCH = 6;

  it("Pan axis 'x' yields pan-y (vertical scroll stays with the browser)", () => {
    const el = makeEl();
    el.style.touchAction = 'auto';
    reg(el, 5, 1, PAN, [], { axis: 'x' });
    expect(el.style.touchAction).toBe('pan-y');
    unregisterWebGesture(5, 1);
    expect(el.style.touchAction).toBe('auto');
  });

  it("Pan axis 'y' yields pan-x", () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, [], { axis: 'y' });
    expect(el.style.touchAction).toBe('pan-x');
  });

  it("Pan axis 'xy' stays none (free drag)", () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, [], { axis: 'xy' });
    expect(el.style.touchAction).toBe('none');
  });

  it('horizontal Fling yields pan-y; vertical yields pan-x; directionless none', () => {
    const el1 = makeEl();
    reg(el1, 11, 1, FLING, [], { direction: 'left' });
    expect(el1.style.touchAction).toBe('pan-y');
    const el2 = makeEl();
    reg(el2, 12, 1, FLING, [], { direction: 'down' });
    expect(el2.style.touchAction).toBe('pan-x');
    const el3 = makeEl();
    reg(el3, 13, 1, FLING, [], {});
    expect(el3.style.touchAction).toBe('none');
  });

  it('conflicting axes on one element collapse to none', () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, [], { axis: 'x' }); // pan-y
    expect(el.style.touchAction).toBe('pan-y');
    reg(el, 5, 2, PAN, [], { axis: 'y' }); // + pan-x → none
    expect(el.style.touchAction).toBe('none');
  });

  it('an axis pan combined with pinch collapses to none, and removal recomputes', () => {
    const el = makeEl();
    el.style.touchAction = 'manipulation';
    reg(el, 5, 1, PAN, [], { axis: 'x' });
    reg(el, 5, 2, PINCH, []);
    expect(el.style.touchAction).toBe('none');
    unregisterWebGesture(5, 2); // pinch gone → back to the pan's pan-y
    expect(el.style.touchAction).toBe('pan-y');
    unregisterWebGesture(5, 1); // nothing needs it → original restored
    expect(el.style.touchAction).toBe('manipulation');
  });

  it('Tap/LongPress alone leave touch-action untouched', () => {
    const el = makeEl();
    el.style.touchAction = 'auto';
    reg(el, 5, 1, TAP, []);
    reg(el, 5, 2, LONGPRESS, []);
    expect(el.style.touchAction).toBe('auto');
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

describe('Pinch + Rotation (two-finger pair)', () => {
  const ROTATION = 5;
  const PINCH = 6;
  const pinchCbs = [
    { name: 'onBegin', callback: { _wkltId: 'pb' } },
    { name: 'onStart', callback: { _wkltId: 'ps' } },
    { name: 'onUpdate', callback: { _wkltId: 'pu' } },
    { name: 'onEnd', callback: { _wkltId: 'pe' } },
  ];
  const rotCbs = [
    { name: 'onStart', callback: { _wkltId: 'rs' } },
    { name: 'onUpdate', callback: { _wkltId: 'ru' } },
    { name: 'onEnd', callback: { _wkltId: 're' } },
  ];
  type PairEvt = {
    type: string;
    params: {
      scale?: number;
      rotation?: number;
      velocity?: number;
      focalX: number;
      focalY: number;
      pageX: number;
      x: number;
    };
  };
  const evtOf = (id: string): PairEvt =>
    runCalls.filter((c) => c.wkltId === id).at(-1)!.event as unknown as PairEvt;

  it('second pointer down forms the pair: onStart with scale 1 at the midpoint focal', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    expect(fired()).toContain('pb'); // onBegin at press start
    expect(fired()).not.toContain('ps');
    el.fire('pointerdown', 100, 0, undefined, undefined, 2);
    expect(fired()).toContain('ps');
    const e = evtOf('ps');
    expect(e.type).toBe('pinch');
    expect(e.params.scale).toBe(1);
    expect(e.params.focalX).toBe(50);
    expect(e.params.x).toBe(50); // focal mirrored into generic coords
  });

  it('spreading the fingers updates scale = currentDistance/baseDistance', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2); // base 100
    el.fire('pointermove', 200, 0, undefined, undefined, 2); // dist 200
    const e = evtOf('pu');
    expect(e.params.scale).toBeCloseTo(2, 5);
    expect(e.params.focalX).toBe(100); // midpoint of (0,0)-(200,0)
    el.fire('pointermove', -50, 0, undefined, undefined, 1); // dist 250
    expect(evtOf('pu').params.scale).toBeCloseTo(2.5, 5); // either finger drives
  });

  it('rotation accumulates signed radians with velocity in rad/ms', () => {
    const el = makeEl();
    reg(el, 5, 1, ROTATION, rotCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2); // angle 0
    expect(evtOf('rs').params.rotation).toBe(0);
    vi.advanceTimersByTime(100);
    el.fire('pointermove', 0, 100, undefined, undefined, 2); // angle π/2
    const e = evtOf('ru');
    expect(e.params.rotation).toBeCloseTo(Math.PI / 2, 5);
    expect(e.params.velocity).toBeCloseTo(Math.PI / 2 / 100, 5);
  });

  it('rotation unwraps across the ±π boundary (no ~2π jump)', () => {
    const el = makeEl();
    reg(el, 5, 1, ROTATION, rotCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', -100, 0, undefined, undefined, 2); // angle exactly π
    vi.advanceTimersByTime(16);
    el.fire('pointermove', -100, -10, undefined, undefined, 2); // just past π → ≈ -π+0.0997
    const r1 = evtOf('ru').params.rotation!;
    expect(r1).toBeCloseTo(Math.atan2(-10, -100) + 2 * Math.PI - Math.PI, 3); // ≈ +0.0997
    expect(Math.abs(r1)).toBeLessThan(0.2); // crucially NOT ≈ 2π
    vi.advanceTimersByTime(16);
    el.fire('pointermove', -100, -30, undefined, undefined, 2); // keeps accumulating
    expect(evtOf('ru').params.rotation!).toBeGreaterThan(r1);
  });

  it('either pair member lifting fires exactly ONE onEnd with final values', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2);
    el.fire('pointermove', 200, 0, undefined, undefined, 2);
    el.fire('pointerup', 200, 0, undefined, undefined, 2); // secondary lifts
    expect(fired().filter((x) => x === 'pe')).toHaveLength(1);
    expect(evtOf('pe').params.scale).toBeCloseTo(2, 5);
    el.fire('pointerup', 0, 0, undefined, undefined, 1); // press ends
    expect(fired().filter((x) => x === 'pe')).toHaveLength(1); // NOT doubled
  });

  it('an up at a fresh position (no preceding move) folds into the final onEnd values', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2); // base 100
    // No pointermove at all — finger 2 lifts at a spread position.
    el.fire('pointerup', 200, 0, undefined, undefined, 2);
    expect(evtOf('pe').params.scale).toBeCloseTo(2, 5); // NOT stale 1
    expect(evtOf('pe').params.focalX).toBe(100);
  });

  it('rotation onEnd reports the last measured velocity, not 0', () => {
    const el = makeEl();
    reg(el, 5, 1, ROTATION, rotCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2);
    vi.advanceTimersByTime(100);
    el.fire('pointermove', 0, 100, undefined, undefined, 2); // π/2 in 100ms
    el.fire('pointerup', 0, 100, undefined, undefined, 2); // up at same position
    const e = evtOf('re');
    expect(e.params.rotation).toBeCloseTo(Math.PI / 2, 5);
    expect(e.params.velocity).toBeCloseTo(Math.PI / 2 / 100, 5); // last measured, not 0
  });

  it('when no pair ever formed, the universal end pass still fires onEnd once', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerup', 0, 0, undefined, undefined, 1); // single-finger press
    expect(fired().filter((x) => x === 'pe')).toHaveLength(1);
  });

  it('a third finger does not re-pair mid-press', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2);
    el.fire('pointerup', 100, 0, undefined, undefined, 2); // pair ends
    runCalls = [];
    el.fire('pointerdown', 50, 50, undefined, undefined, 3); // third finger
    expect(fired()).not.toContain('ps'); // no new pair this press
  });

  it('pinch and rotation on the same element both track the same pair', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    reg(el, 5, 2, ROTATION, rotCbs);
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2);
    el.fire('pointermove', 0, 100, undefined, undefined, 2);
    expect(evtOf('pu').params.scale).toBeCloseTo(1, 5); // same distance
    expect(evtOf('ru').params.rotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it('tap stays suppressed during two-finger contact with pinch registered', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    reg(el, 5, 2, TAP, [{ name: 'onStart', callback: { _wkltId: 'tap' } }]);
    el.fire('pointerdown', 100, 100, undefined, undefined, 1);
    el.fire('pointerdown', 110, 100, undefined, undefined, 2);
    el.fire('pointerup', 110, 100, undefined, undefined, 2);
    el.fire('pointerup', 101, 100, undefined, undefined, 1);
    expect(fired()).not.toContain('tap');
  });

  it('pinch/rotation set touch-action:none and restore on removal', () => {
    const el = makeEl();
    el.style.touchAction = 'manipulation';
    reg(el, 5, 1, PINCH, []);
    expect(el.style.touchAction).toBe('none');
    unregisterWebGesture(5, 1);
    expect(el.style.touchAction).toBe('manipulation');
  });
});

describe('Fling', () => {
  const FLING = 1;
  const flingCbs = [
    { name: 'onBegin', callback: { _wkltId: 'b' } },
    { name: 'onStart', callback: { _wkltId: 'fling' } },
    { name: 'onEnd', callback: { _wkltId: 'e' } },
  ];

  /** Drive a horizontal drag: down at (0,0), a move every 20ms, up at the end. */
  function drag(el: FakeEl, stepPx: number, steps: number, stepMs: number): void {
    el.fire('pointerdown', 0, 0);
    let x = 0;
    for (let i = 0; i < steps; i++) {
      vi.advanceTimersByTime(stepMs);
      x += stepPx;
      el.fire('pointermove', x, 0);
    }
    el.fire('pointerup', x, 0);
  }

  it('a fast rightward flick fires onStart with velocity params, then onEnd', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, { direction: 'right' });
    drag(el, 30, 3, 20); // 90px in 60ms → vx = 1.5 px/ms
    const f = fired();
    expect(f).toContain('fling');
    expect(f[f.length - 1]).toBe('e'); // universal onEnd still last
    const evt = runCalls.find((c) => c.wkltId === 'fling')!.event as unknown as {
      type: string;
      params: { velocityX: number; velocityY: number; pageX: number };
    };
    expect(evt.type).toBe('fling');
    expect(evt.params.velocityX).toBeCloseTo(1.5, 5);
    expect(evt.params.velocityY).toBe(0);
  });

  it('a slow drag does not fling (velocity under the default threshold)', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, {});
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(200);
    el.fire('pointermove', 10, 0);
    vi.advanceTimersByTime(200);
    el.fire('pointermove', 20, 0);
    vi.advanceTimersByTime(50);
    el.fire('pointerup', 25, 0); // trailing window: 5px / 50ms = 0.1 px/ms << 0.3
    expect(fired()).not.toContain('fling');
    expect(fired()).toContain('e'); // onEnd always fires
  });

  it('pausing before release kills the fling', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, {});
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(20);
    el.fire('pointermove', 60, 0); // fast start…
    vi.advanceTimersByTime(400); // …then a long hold
    el.fire('pointerup', 60, 0);
    expect(fired()).not.toContain('fling');
  });

  it('direction mismatch suppresses the fling', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, { direction: 'left' });
    drag(el, 30, 3, 20); // rightward flick vs direction: 'left'
    expect(fired()).not.toContain('fling');
  });

  it('minVelocity is honored (px/ms)', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, { minVelocity: 3 });
    drag(el, 30, 3, 20); // 1.5 px/ms < 3
    expect(fired()).not.toContain('fling');
    runCalls = [];
    drag(el, 80, 3, 20); // 4 px/ms ≥ 3
    expect(fired()).toContain('fling');
  });

  it('a direction-less fling matches any direction by overall magnitude', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, {});
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(20);
    el.fire('pointermove', -20, -20);
    vi.advanceTimersByTime(20);
    el.fire('pointerup', -40, -40); // diagonal up-left, |v| = √2 ≈ 1.41 px/ms
    expect(fired()).toContain('fling');
  });

  it('fling sets touch-action:none and restores it on removal', () => {
    const el = makeEl();
    el.style.touchAction = 'auto';
    reg(el, 5, 1, FLING, []);
    expect(el.style.touchAction).toBe('none');
    unregisterWebGesture(5, 1);
    expect(el.style.touchAction).toBe('auto');
  });

  it('a flick on composed Fling+Tap does not double as a tap', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, {});
    reg(el, 5, 2, TAP, [{ name: 'onStart', callback: { _wkltId: 'tap' } }]);
    drag(el, 30, 3, 20);
    expect(fired()).toContain('fling');
    expect(fired()).not.toContain('tap');
  });

  it('a short fast flick inside the tap tolerance flings and still suppresses tap', () => {
    // 9px in 20ms = 0.45 px/ms ≥ minVelocity, but within the 10px tap
    // tolerance — the fling match must explicitly win over the tap.
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, {});
    reg(el, 5, 2, TAP, [{ name: 'onStart', callback: { _wkltId: 'tap' } }]);
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(20);
    el.fire('pointerup', 9, 0);
    expect(fired()).toContain('fling');
    expect(fired()).not.toContain('tap');
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

describe('arena relations (waitFor / simultaneous)', () => {
  const FLING = 1;
  const panCbs = [
    { name: 'onStart', callback: { _wkltId: 'pan-start' } },
    { name: 'onUpdate', callback: { _wkltId: 'pan-update' } },
    { name: 'onEnd', callback: { _wkltId: 'pan-end' } },
  ];
  const lpCbs = [
    { name: 'onStart', callback: { _wkltId: 'lp-start' } },
    { name: 'onEnd', callback: { _wkltId: 'lp-end' } },
  ];
  const flingCbs = [{ name: 'onStart', callback: { _wkltId: 'fling-start' } }];
  const tapCbs = [{ name: 'onStart', callback: { _wkltId: 'tap-start' } }];

  it('Race(Pan, LongPress): a fast drag starts the pan; LP.onStart never fires, LP.onEnd does', () => {
    const el = makeEl();
    // Gesture.Race = mutual waitFor
    reg(el, 5, 1, PAN, panCbs, { minDistance: 8 }, { waitFor: [2] });
    reg(el, 5, 2, LONGPRESS, lpCbs, { minDuration: 350 }, { waitFor: [1] });
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(16);
    el.fire('pointermove', 50, 0);
    vi.advanceTimersByTime(500); // LP timer window elapses — must stay dead
    el.fire('pointerup', 50, 0);
    expect(fired()).toContain('pan-start');
    expect(fired()).not.toContain('lp-start');
    expect(fired()).toContain('lp-end'); // onEnd always fires
  });

  it('Race(Pan, LongPress): holding still activates LP; a later drag does not start the pan', () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, panCbs, { minDistance: 8 }, { waitFor: [2] });
    reg(el, 5, 2, LONGPRESS, lpCbs, { minDuration: 350 }, { waitFor: [1] });
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(350); // LP wins the race
    expect(fired()).toContain('lp-start');
    el.fire('pointermove', 60, 0); // drag afterwards
    el.fire('pointermove', 90, 0);
    expect(fired()).not.toContain('pan-start'); // pan lost the race
    el.fire('pointerup', 90, 0);
    expect(fired()).toContain('pan-end'); // onEnd still universal
  });

  it('Simultaneous(Pan, LongPress): hold then drag fires both onStarts', () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, panCbs, { minDistance: 8 }, { simultaneous: [2] });
    reg(el, 5, 2, LONGPRESS, lpCbs, { minDuration: 350 }, { simultaneous: [1] });
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(350);
    expect(fired()).toContain('lp-start');
    el.fire('pointermove', 50, 0);
    expect(fired()).toContain('pan-start');
  });

  it('Exclusive(Fling, Pan): a fast flick flings; the pan never starts', () => {
    const el = makeEl();
    // Gesture.Exclusive: later items waitFor all earlier ones
    reg(el, 5, 1, FLING, flingCbs, { direction: 'right' });
    reg(el, 5, 2, PAN, panCbs, { minDistance: 8 }, { waitFor: [1] });
    el.fire('pointerdown', 0, 0);
    for (let i = 1; i <= 3; i++) {
      vi.advanceTimersByTime(20);
      el.fire('pointermove', i * 30, 0);
    }
    el.fire('pointerup', 90, 0); // 1.5 px/ms → fling
    expect(fired()).toContain('fling-start');
    expect(fired()).not.toContain('pan-start');
  });

  it('Exclusive(Fling, Pan): a slow drag hands over to the pan once the fling deadline passes', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, { direction: 'right' });
    reg(el, 5, 2, PAN, panCbs, { minDistance: 8 }, { waitFor: [1] });
    el.fire('pointerdown', 0, 0);
    for (let i = 1; i <= 4; i++) {
      vi.advanceTimersByTime(150); // crosses FLING_MAX_MS (300) at step 2
      el.fire('pointermove', i * 20, 0);
    }
    expect(fired()).toContain('pan-start'); // started mid-press after handover
    el.fire('pointerup', 80, 0);
    expect(fired()).not.toContain('fling-start');
  });

  it('Exclusive(Fling, Tap): a gentle tap fires once the fling fails at release', () => {
    const el = makeEl();
    reg(el, 5, 1, FLING, flingCbs, {});
    reg(el, 5, 2, TAP, tapCbs, {}, { waitFor: [1] });
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(80);
    el.fire('pointerup', 2, 0); // no velocity → fling fails at up → tap unblocked
    expect(fired()).not.toContain('fling-start');
    expect(fired()).toContain('tap-start');
  });

  it('no relations → everything still co-fires (compat invariant)', () => {
    const el = makeEl();
    reg(el, 5, 1, PAN, panCbs, { minDistance: 0 });
    reg(el, 5, 2, LONGPRESS, lpCbs, { minDuration: 100 });
    el.fire('pointerdown', 0, 0);
    vi.advanceTimersByTime(100); // LP fires (still, within tolerance)
    el.fire('pointermove', 3, 0); // small move: within tolerance → pan starts too
    expect(fired()).toContain('lp-start');
    expect(fired()).toContain('pan-start'); // unrelated gestures untouched by rule 2
  });
});

describe('arena relations × Pinch/Rotation', () => {
  const PINCH = 6;
  const pinchCbs = [
    { name: 'onStart', callback: { _wkltId: 'pinch-start' } },
    { name: 'onEnd', callback: { _wkltId: 'pinch-end' } },
  ];
  const tapCbs = [{ name: 'onStart', callback: { _wkltId: 'tap-start' } }];
  const panCbs = [{ name: 'onStart', callback: { _wkltId: 'pan-start' } }];

  it('a Tap waiting on a Pinch fires once the single-finger press releases', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    reg(el, 5, 2, TAP, tapCbs, {}, { waitFor: [1] });
    el.fire('pointerdown', 0, 0);
    el.fire('pointerup', 2, 0); // no second finger — pinch fails at release
    expect(fired()).not.toContain('pinch-start');
    expect(fired()).toContain('tap-start');
  });

  it('an activated Pinch fails a related Pan (Exclusive(Pinch, Pan))', () => {
    const el = makeEl();
    reg(el, 5, 1, PINCH, pinchCbs);
    reg(el, 5, 2, PAN, panCbs, { minDistance: 8 }, { waitFor: [1] });
    el.fire('pointerdown', 0, 0, undefined, undefined, 1);
    el.fire('pointerdown', 100, 0, undefined, undefined, 2); // pair forms → pinch active
    expect(fired()).toContain('pinch-start');
    el.fire('pointermove', 60, 0, undefined, undefined, 1); // primary drags
    el.fire('pointermove', 90, 0, undefined, undefined, 1);
    expect(fired()).not.toContain('pan-start'); // pan lost to the pinch
  });
});
