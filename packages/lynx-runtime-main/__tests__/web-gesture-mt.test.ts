/**
 * Web Tap recognizer (`web-gesture-mt.ts`).
 *
 * On web (`@lynx-js/web-core`, no gesture arena) the gesture op routes here:
 * register pointer events on the element, run a state machine, and invoke the
 * gesture's worklet callbacks via `globalThis.runWorklet`. These tests drive the
 * dispatcher directly (the fn web-core would call on each pointer event).
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

const TAP = 3;
const DISPATCH_ID = '__sigxWebGestureTouch';

let runCalls: Array<{ wkltId: unknown; event: { type?: string } }>;

function getDispatcher(): (this: { _c?: { ev?: number } }, e: unknown) => void {
  const impl = (globalThis as { lynxWorkletImpl?: { _workletMap?: Record<string, (...a: unknown[]) => unknown> } })
    .lynxWorkletImpl;
  return impl!._workletMap![DISPATCH_ID] as never;
}

/** Fire a pointer event at the dispatcher as web-core would (this._c.ev = wvid). */
function fire(wvid: number, type: string): void {
  getDispatcher().call({ _c: { ev: wvid } }, { type });
}

beforeEach(() => {
  resetWebGestures();
  runCalls = [];
  vi.stubGlobal('__AddEvent', vi.fn());
  vi.stubGlobal('lynxWorkletImpl', { _workletMap: {} });
  vi.stubGlobal('runWorklet', (ctx: { _wkltId: unknown }, args: unknown[]) => {
    runCalls.push({ wkltId: ctx._wkltId, event: args[0] as { type?: string } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebGestures();
});

describe('web Tap recognizer', () => {
  function registerTap(wvid = 5, gid = 1): void {
    registerWebGesture({} as never, wvid, gid, TAP, {
      callbacks: [
        { name: 'onBegin', callback: { _wkltId: 'cb-begin' } },
        { name: 'onStart', callback: { _wkltId: 'cb-start' } },
        { name: 'onEnd', callback: { _wkltId: 'cb-end' } },
      ],
    });
  }

  it('registers pointer events on the first gesture for an element', () => {
    const addEvent = globalThis.__AddEvent as unknown as ReturnType<typeof vi.fn>;
    registerTap();
    const names = addEvent.mock.calls.map((c) => c[2]);
    expect(names).toEqual(['pointerdown', 'pointerup', 'pointercancel']);
  });

  it('fires onBegin on pointerdown, then onStart + onEnd on pointerup, in order', () => {
    registerTap();
    fire(5, 'pointerdown');
    fire(5, 'pointerup');
    const fired = runCalls.map((c) => c.wkltId);
    expect(fired).toContain('cb-begin');
    expect(fired).toContain('cb-start');
    expect(fired).toContain('cb-end');
    // onBegin < onStart < onEnd (onStart must precede onEnd so a press emit is
    // recorded before any onEnd fallback runs).
    expect(fired.indexOf('cb-begin')).toBeLessThan(fired.indexOf('cb-start'));
    expect(fired.indexOf('cb-start')).toBeLessThan(fired.indexOf('cb-end'));
  });

  it('does not fire onStart on pointercancel (no tap), but resets via onEnd', () => {
    registerTap();
    fire(5, 'pointerdown');
    runCalls = [];
    fire(5, 'pointercancel');
    const fired = runCalls.map((c) => c.wkltId);
    expect(fired).toContain('cb-end');
    expect(fired).not.toContain('cb-start');
  });

  it('drives onEnd for ALL gestures on the element (so a composed Pressable resets its visual)', () => {
    // Pressable registers Simultaneous(Tap, LongPress); the visual reset lives
    // in LongPress.onEnd, so the recognizer must end every gesture on pointerup.
    registerWebGesture({} as never, 5, 1, TAP, {
      callbacks: [{ name: 'onStart', callback: { _wkltId: 'tap-start' } }],
    });
    registerWebGesture({} as never, 5, 2, 4 /* LONGPRESS */, {
      callbacks: [{ name: 'onEnd', callback: { _wkltId: 'lp-end' } }],
    });
    fire(5, 'pointerdown');
    fire(5, 'pointerup');
    const fired = runCalls.map((c) => c.wkltId);
    expect(fired).toContain('tap-start'); // Tap emits
    expect(fired).toContain('lp-end'); // LongPress.onEnd resets the visual
  });

  it('unregister tears down the pointer listeners when the last gesture is removed', () => {
    const addEvent = globalThis.__AddEvent as unknown as ReturnType<typeof vi.fn>;
    registerTap(5, 1);
    addEvent.mockClear();
    unregisterWebGesture(5, 1);
    expect(addEvent).toHaveBeenCalledTimes(3);
    expect(addEvent.mock.calls.every((c) => c[3] === undefined)).toBe(true);
    // After teardown a stray pointer event is a no-op.
    runCalls = [];
    fire(5, 'pointerdown');
    expect(runCalls).toHaveLength(0);
  });
});

describe('worklet setStyleProperties web fallback (SET_MT_REF)', () => {
  it('patches the worklet ref so setStyleProperties falls back to __SetInlineStyles on web', () => {
    resetMainThreadState();
    const setInline = vi.fn();
    vi.stubGlobal('__SetInlineStyles', setInline);
    vi.stubGlobal('__FlushElementTree', vi.fn());
    // Web signal: the gesture-arena PAPI is absent.
    vi.stubGlobal('__SetGestureDetector', undefined);

    // Upstream's worklet element wrapper, whose setStyleProperties throws on web
    // (web-core's element has no setProperty).
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

    // The patched wrapper now routes a failing apply to __SetInlineStyles.
    wrapper.setStyleProperties({ opacity: 0.5 });
    expect(setInline).toHaveBeenCalledWith(rawEl, { opacity: 0.5 });
    // The wrapper's debounced flush schedules a `__FlushElementTree()`
    // microtask; the top-level afterEach unstubs globals only after it runs.
  });
});
