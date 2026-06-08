/**
 * Web gesture recognizer (MT side).
 *
 * Upstream `@lynx-js/web-core` has **no** gesture arena — `__SetGestureDetector`
 * is undefined there. But it DOES deliver `touchstart`/`touchend`/`touchcancel`
 * as Lynx events (root-delegated DOM listeners, see web-core's `WASMJSBinding`)
 * and runs MT worklet callbacks via `globalThis.runWorklet`. So on web we
 * reimplement the recognizer here: register touch events on the element, run a
 * small state machine, and invoke the gesture's `'main thread'` worklet
 * callbacks (`onBegin`/`onStart`/`onEnd`) — exactly the ones the native arena
 * would. The callbacks then do their thing (visual via `setStyleProperties`,
 * emit via `runOnBackground`), both of which already work on web.
 *
 * Scope: **Tap** only (the dominant gesture — `Pressable`). LongPress / Pan /
 * Pinch / Rotation / Fling and arena relations (waitFor/simultaneous/…) are
 * deferred. Because `Pressable` composes `Simultaneous(Tap, LongPress)` and puts
 * its visual *reset* in `LongPress.onEnd`, the recognizer drives the lifecycle of
 * **every** gesture registered on an element (not just the Tap), so the pressed
 * style is cleared on touch-up. Only `onStart` is gated to the Tap (that's what
 * emits `press`); LongPress's own `onStart` (the long-hold) is not fired yet.
 *
 * Native is unaffected — this module is only reached when `__SetGestureDetector`
 * is absent (the web path in `ops-apply.ts`).
 */

// Gesture type ids — mirror of `GestureType` in
// `packages/lynx-runtime/src/native/gesture-detector.ts`.
const TAP = 3;

const DEFAULT_MAX_DISTANCE = 10;

/** Worklet-map id under which we register the touch dispatcher. */
const WEB_GESTURE_WKLT = '__sigxWebGestureTouch';

interface WorkletCtx {
  _wkltId: string;
  _c?: Record<string, unknown>;
}

interface GestureEntry {
  type: number;
  callbacks: Record<string, WorkletCtx>;
  config: Record<string, unknown>;
}

interface ElementGestures {
  /** Raw MainThreadElement — kept for unregistering the touch events. */
  el: MainThreadElement;
  gestures: Map<number, GestureEntry>;
  touch?: { x: number; y: number; t: number };
}

/** elementWvid → registered gestures + transient touch state. */
const byElement = new Map<number, ElementGestures>();
/** Raw element → elementWvid, for resolving the dispatcher's target. */
const wvidByElement = new Map<MainThreadElement, number>();

let dispatcherInstalled = false;

interface WorkletImpl {
  _workletMap?: Record<string, (...args: unknown[]) => unknown>;
}

function getWorkletImpl(): WorkletImpl | undefined {
  return (globalThis as { lynxWorkletImpl?: WorkletImpl }).lynxWorkletImpl;
}

/**
 * Install the touch dispatcher into upstream's `_workletMap` once. web-core
 * runs it via `runWorklet({_wkltId}, [event])` when a registered touch event
 * fires; it binds `this` to `{_c}`, so we read the element wvid from `this._c.ev`
 * (with a `currentTarget` fallback).
 */
function ensureDispatcher(): void {
  if (dispatcherInstalled) return;
  const impl = getWorkletImpl();
  if (!impl) return;
  if (!impl._workletMap) impl._workletMap = {};
  impl._workletMap[WEB_GESTURE_WKLT] = function (
    this: { _c?: { ev?: number } } | undefined,
    event: unknown,
  ): void {
    let wvid = this?._c?.ev;
    if (typeof wvid !== 'number') {
      const ct = (event as { currentTarget?: { elementRefptr?: MainThreadElement } } | undefined)
        ?.currentTarget?.elementRefptr;
      if (ct) wvid = wvidByElement.get(ct);
    }
    if (typeof wvid === 'number') handleTouch(wvid, event);
  };
  dispatcherInstalled = true;
}

// Pointer events (not touch) so the recognizer works for mouse, touch AND pen
// with no mouse/touch double-fire. web-core delivers them as Lynx events the
// same way. Trade-off: web-core only extracts coordinates for `touch*`/`mouse*`
// events, not `pointer*`, so the movement-cancel check degrades to "always a
// tap" on web for now — fine for buttons; revisit with the Pan recognizer.
const TOUCH_EVENTS = ['pointerdown', 'pointerup', 'pointercancel'] as const;

function touchHandler(wvid: number): { type: 'worklet'; value: WorkletCtx } {
  return { type: 'worklet', value: { _wkltId: WEB_GESTURE_WKLT, _c: { ev: wvid } } };
}

/**
 * Register one gesture on an element (web path). The first gesture on an element
 * also installs the shared touch listeners.
 */
export function registerWebGesture(
  el: MainThreadElement,
  elementWvid: number,
  gestureId: number,
  type: number,
  config: {
    callbacks: { name: string; callback: Record<string, unknown> }[];
    config?: Record<string, unknown>;
  },
): void {
  ensureDispatcher();

  let entry = byElement.get(elementWvid);
  const firstForElement = !entry;
  if (!entry) {
    entry = { el, gestures: new Map() };
    byElement.set(elementWvid, entry);
    wvidByElement.set(el, elementWvid);
  }

  const callbacks: Record<string, WorkletCtx> = {};
  for (const cb of config.callbacks) callbacks[cb.name] = cb.callback as unknown as WorkletCtx;
  entry.gestures.set(gestureId, {
    type,
    callbacks,
    config: config.config ?? {},
  });

  if (firstForElement) {
    const handler = touchHandler(elementWvid);
    for (const name of TOUCH_EVENTS) {
      try {
        __AddEvent(el, 'bindEvent', name, handler as unknown as string);
      } catch {
        /* host may reject the event registration — gesture just won't fire */
      }
    }
  }
}

/** Remove one gesture; tear down touch listeners when the element has none left. */
export function unregisterWebGesture(elementWvid: number, gestureId: number): void {
  const entry = byElement.get(elementWvid);
  if (!entry) return;
  entry.gestures.delete(gestureId);
  if (entry.gestures.size > 0) return;

  for (const name of TOUCH_EVENTS) {
    try {
      // Lynx PAPI: `undefined` as the 4th arg unregisters the slot.
      __AddEvent(entry.el, 'bindEvent', name, undefined as unknown as string);
    } catch {
      /* ignore */
    }
  }
  wvidByElement.delete(entry.el);
  byElement.delete(elementWvid);
}

/**
 * Best-effort pointer coordinate out of web-core's cross-thread event. web-core
 * fills coords for `mouse*` (top-level x/y) and `touch*`/`click` (`detail.x/y`)
 * but not `pointer*` — so this is 0 for pointer events. Only used for the
 * movement-cancel heuristic, which therefore no-ops on web for now.
 */
function pointOf(event: unknown): { x: number; y: number } {
  const e = event as {
    clientX?: number;
    clientY?: number;
    detail?: { x?: number; y?: number } | number;
  };
  if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY ?? 0 };
  const d = e.detail;
  if (d && typeof d === 'object') return { x: d.x ?? 0, y: d.y ?? 0 };
  return { x: 0, y: 0 };
}

/** Synthesize the `{ params }` event shape the gesture worklet callbacks read. */
function synthEvent(type: string, p: { x: number; y: number }): unknown {
  return { type, params: { pageX: p.x, pageY: p.y, x: p.x, y: p.y } };
}

function runCb(entry: GestureEntry, name: string, event: unknown): void {
  const cb = entry.callbacks[name];
  if (!cb?._wkltId) return;
  const runWorklet = (globalThis as {
    runWorklet?: (ctx: WorkletCtx, args: unknown[]) => unknown;
  }).runWorklet;
  if (typeof runWorklet !== 'function') return;
  try {
    // Pass the FULL callback ctx — not just `{_wkltId,_c}`. The worklet body
    // also reads `this._jsFn` (the `runOnBackground` handles that emit to BG)
    // and `this._execId`; dropping them makes the callback throw on
    // `Cannot destructure property '_jsFn1' of 'this._jsFn'`. runWorklet
    // hydrates the whole ctx (refs, jsFns) before invoking.
    runWorklet(cb, [event]);
  } catch (e) {
    console.log('[sigx-mt] web-gesture callback threw:', name, String(e));
  }
}

/** Largest tap `maxDistance` across the element's Tap gestures (px). */
function tapMaxDistance(entry: ElementGestures): number {
  let max = DEFAULT_MAX_DISTANCE;
  for (const g of entry.gestures.values()) {
    if (g.type === TAP && typeof g.config.maxDistance === 'number') {
      max = Math.max(max, g.config.maxDistance as number);
    }
  }
  return max;
}

/** Touch state machine — invoked by the dispatcher on each touch event. */
function handleTouch(elementWvid: number, event: unknown): void {
  const entry = byElement.get(elementWvid);
  if (!entry) return;
  const type = (event as { type?: string }).type ?? '';
  const p = pointOf(event);

  if (type === 'pointerdown') {
    entry.touch = { x: p.x, y: p.y, t: nowMs() };
    for (const g of entry.gestures.values()) runCb(g, 'onBegin', synthEvent(type, p));
    return;
  }

  if (type === 'pointerup') {
    const start = entry.touch;
    entry.touch = undefined;
    const maxD = tapMaxDistance(entry);
    const dx = start ? p.x - start.x : 0;
    const dy = start ? p.y - start.y : 0;
    const isTap = !!start && dx * dx + dy * dy <= maxD * maxD;
    const evt = synthEvent(type, p);
    // Pass 1: Tap.onStart (emits press) — must run before onEnd so the
    // LongPress.onEnd press-fallback sees `pressEmitted`.
    if (isTap) {
      for (const g of entry.gestures.values()) {
        if (g.type === TAP) runCb(g, 'onStart', evt);
      }
    }
    // Pass 2: onEnd for every gesture (resets pressed visual, etc.).
    for (const g of entry.gestures.values()) runCb(g, 'onEnd', evt);
    return;
  }

  if (type === 'pointercancel') {
    entry.touch = undefined;
    const evt = synthEvent(type, p);
    for (const g of entry.gestures.values()) runCb(g, 'onEnd', evt);
  }
}

function nowMs(): number {
  // Date.now is available on the web MT; avoid performance.now coupling.
  return Date.now();
}

/** Hot-reload / test reset hook. */
export function resetWebGestures(): void {
  byElement.clear();
  wvidByElement.clear();
  // Force re-install on the next register — the worklet runtime (and its
  // `_workletMap`) may have been replaced (hot reload, test re-stub).
  dispatcherInstalled = false;
}
