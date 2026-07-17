/**
 * Web gesture recognizer (MT side).
 *
 * Upstream `@lynx-js/web-core` has **no** gesture arena — `__SetGestureDetector`
 * is undefined there. So on web we reimplement the recognizer here and invoke
 * the gesture's `'main thread'` worklet callbacks (`onBegin`/`onStart`/
 * `onUpdate`/`onEnd`) — exactly the ones the native arena would. The callbacks
 * then do their thing (visual via `setStyleProperties`, emit via
 * `runOnBackground`), both of which already work on web.
 *
 * Event source: **native pointer listeners attached directly on the element**.
 * web-core's elements are real DOM nodes (`document.createElement('x-view')`),
 * so `el.addEventListener('pointerdown'|'pointermove'|'pointerup'|
 * 'pointercancel', …)` gives real `clientX/Y` coordinates, and
 * `setPointerCapture` keeps move/up flowing to the element even when the pointer
 * leaves its bounds (needed for drag). Pointer (not touch/mouse) events ⇒ mouse,
 * touch and pen all work with no double-fire. (The earlier Tap-only slice routed
 * through web-core's own event system, which has no coords for `pointer*`; this
 * supersedes it.)
 *
 * Supported: **Tap**, **LongPress**, **Pan**. Pinch / Rotation / Fling and arena
 * relations (waitFor/simultaneous/continueWith) are not implemented — composed
 * gestures still drive every base's lifecycle (e.g. `Pressable`'s
 * `Simultaneous(Tap, LongPress)` resets its visual in `LongPress.onEnd`).
 *
 * Pointer tracking is **per-pointerId** (a `Map`), so a second finger no longer
 * clobbers the active press: the press is driven by the *primary* pointer (the
 * first one down); a secondary contact marks the press multi-touch (which
 * disqualifies Tap and cancels pending LongPress timers, mirroring the native
 * recognizers failing on a second touch) and otherwise just tracks alongside —
 * the foundation for two-finger Pinch/Rotation. A secondary lift never ends the
 * press; only the primary's `pointerup`/`pointercancel` does. Deferred: pointer
 * promotion (continuing a pan on the surviving finger when the primary lifts).
 *
 * Native is unaffected — this module is only reached when `__SetGestureDetector`
 * is absent (the web path in `ops-apply.ts`).
 */

// Gesture type ids — mirror of `GestureType` in
// `packages/lynx-runtime/src/native/gesture-detector.ts`.
const PAN = 0;
const TAP = 3;
const LONGPRESS = 4;

const DEFAULT_MAX_DISTANCE = 10; // px — tap/long-press movement tolerance
const DEFAULT_LONGPRESS_MS = 500;

interface WorkletCtx {
  _wkltId: string;
  _c?: Record<string, unknown>;
}

interface GestureEntry {
  type: number;
  callbacks: Record<string, WorkletCtx>;
  config: Record<string, unknown>;
}

/** Minimal native pointer-event shape we read. */
interface PointerLike {
  type: string;
  clientX: number;
  clientY: number;
  /** Page coords (scroll-offset aware) — preferred for the callbacks' pageX/Y. */
  pageX?: number;
  pageY?: number;
  pointerId?: number;
}

/** Minimal DOM-element surface (web-core elements are real DOM nodes). */
interface DomEl {
  addEventListener?: (type: string, fn: (e: PointerLike) => void) => void;
  removeEventListener?: (type: string, fn: (e: PointerLike) => void) => void;
  setPointerCapture?: (id: number) => void;
  style?: { touchAction?: string };
}

/** One currently-down pointer (keyed by pointerId in `ElementGestures.pointers`). */
interface PointerState {
  startX: number;
  startY: number;
  startT: number;
  /** Last client coords. */
  x: number;
  y: number;
}

interface ElementGestures {
  el: MainThreadElement;
  gestures: Map<number, GestureEntry>;
  listeners?: { type: string; fn: (e: PointerLike) => void }[];
  /** Saved `touch-action` to restore on teardown (set to 'none' for Pan). */
  prevTouchAction?: string;
  // ── transient per-press state ──
  /** All currently-down pointers, by (normalized) pointerId. */
  pointers?: Map<number, PointerState>;
  /** A press is in progress (the primary pointer is down). */
  active?: boolean;
  /** The pointer driving the press — the first one down. */
  primaryId?: number;
  /** A second pointer landed during this press — disqualifies Tap & LongPress. */
  multiTouch?: boolean;
  /** Moved past the tap/long-press tolerance — disqualifies tap & long-press. */
  moved?: boolean;
  /** Gesture ids whose Pan `onStart` has fired this press. */
  panStarted?: Set<number>;
  /** Gesture ids whose LongPress fired this press. */
  lpFired?: Set<number>;
  lpTimers?: Map<number, ReturnType<typeof setTimeout>>;
}

/** elementWvid → registered gestures + transient state. */
const byElement = new Map<number, ElementGestures>();

const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

/**
 * Register one gesture on an element (web path). The first gesture on an element
 * attaches the shared pointer listeners; a Pan gesture also sets
 * `touch-action: none` so the browser doesn't claim the drag for scrolling.
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
  let entry = byElement.get(elementWvid);
  const firstForElement = !entry;
  if (!entry) {
    entry = { el, gestures: new Map() };
    byElement.set(elementWvid, entry);
  }

  const callbacks: Record<string, WorkletCtx> = {};
  for (const cb of config.callbacks) callbacks[cb.name] = cb.callback as unknown as WorkletCtx;
  entry.gestures.set(gestureId, { type, callbacks, config: config.config ?? {} });

  if (firstForElement) attachListeners(entry);
  if (type === PAN) setTouchActionNone(entry);
}

/** Remove one gesture; tear down listeners when the element has none left. */
export function unregisterWebGesture(elementWvid: number, gestureId: number): void {
  const entry = byElement.get(elementWvid);
  if (!entry) return;
  entry.gestures.delete(gestureId);
  // Restore `touch-action` as soon as no Pan remains — even if other (non-Pan)
  // gestures stay on the element — so a removed drag doesn't leave the element
  // stuck unscrollable.
  if (!hasPan(entry)) restoreTouchAction(entry);
  if (entry.gestures.size > 0) return;
  clearLpTimers(entry);
  detachListeners(entry);
  byElement.delete(elementWvid);
}

function hasPan(entry: ElementGestures): boolean {
  for (const g of entry.gestures.values()) if (g.type === PAN) return true;
  return false;
}

function restoreTouchAction(entry: ElementGestures): void {
  if (entry.prevTouchAction === undefined) return;
  const el = entry.el as unknown as DomEl;
  if (el.style) el.style.touchAction = entry.prevTouchAction;
  entry.prevTouchAction = undefined;
}

function attachListeners(entry: ElementGestures): void {
  const el = entry.el as unknown as DomEl;
  if (typeof el.addEventListener !== 'function') return; // not a DOM node
  const handlers: Record<string, (e: PointerLike) => void> = {
    pointerdown: (e) => safe(() => onDown(entry, e)),
    pointermove: (e) => safe(() => onMove(entry, e)),
    pointerup: (e) => safe(() => onUp(entry, e)),
    pointercancel: (e) => safe(() => onCancel(entry, e)),
  };
  entry.listeners = [];
  for (const type of POINTER_EVENTS) {
    const fn = handlers[type]!;
    el.addEventListener(type, fn);
    entry.listeners.push({ type, fn });
  }
}

function detachListeners(entry: ElementGestures): void {
  const el = entry.el as unknown as DomEl;
  for (const l of entry.listeners ?? []) el.removeEventListener?.(l.type, l.fn);
  entry.listeners = undefined;
  restoreTouchAction(entry);
}

function setTouchActionNone(entry: ElementGestures): void {
  const el = entry.el as unknown as DomEl;
  if (!el.style || entry.prevTouchAction !== undefined) return;
  entry.prevTouchAction = el.style.touchAction ?? '';
  el.style.touchAction = 'none';
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.log('[sigx-mt] web-gesture handler threw:', String(e));
  }
}

// ── State machine ──────────────────────────────────────────────────────────

/** Normalize a pointer id (`undefined` on odd hosts / synthetic events → 0). */
function pid(e: PointerLike): number {
  return e.pointerId ?? 0;
}

function onDown(entry: ElementGestures, e: PointerLike): void {
  const id = pid(e);
  const pointers = (entry.pointers ??= new Map());
  pointers.set(id, {
    startX: e.clientX,
    startY: e.clientY,
    startT: nowMs(),
    x: e.clientX,
    y: e.clientY,
  });
  // Capture so move/up keep flowing to this element even outside its bounds.
  if (e.pointerId != null) {
    try {
      (entry.el as unknown as DomEl).setPointerCapture?.(e.pointerId);
    } catch {
      /* capture unsupported — drag tracking degrades to in-bounds only */
    }
  }

  if (entry.active) {
    // Secondary contact during an active press: the press becomes multi-touch,
    // which disqualifies Tap (checked in onUp) and cancels pending LongPress
    // timers — mirroring the native recognizers failing on a second touch. No
    // re-fired onBegin; the press's lifecycle stays owned by the primary.
    entry.multiTouch = true;
    clearLpTimers(entry);
    return;
  }
  if (pointers.size > 1) {
    // A stale pointer is still down from an already-ended press (its primary
    // lifted first). No new press starts until every pointer lifts.
    return;
  }

  // Press start (first pointer down).
  entry.active = true;
  entry.primaryId = id;
  entry.multiTouch = false;
  entry.moved = false;
  entry.panStarted = new Set();
  entry.lpFired = new Set();
  const evt = synthEvent('pointerdown', e);
  for (const [gid, g] of entry.gestures) {
    runCb(g, 'onBegin', evt);
    if (g.type === LONGPRESS) {
      const ms = (g.config.minDuration as number) ?? DEFAULT_LONGPRESS_MS;
      (entry.lpTimers ??= new Map()).set(
        gid,
        setTimeout(() => fireLongPress(entry, gid), ms),
      );
    }
  }
}

function primaryPointer(entry: ElementGestures): PointerState | undefined {
  return entry.primaryId != null ? entry.pointers?.get(entry.primaryId) : undefined;
}

function fireLongPress(entry: ElementGestures, gid: number): void {
  if (!entry.active || entry.moved || entry.multiTouch) return;
  const g = entry.gestures.get(gid);
  if (!g) return;
  const p = primaryPointer(entry);
  if (!p) return;
  entry.lpFired!.add(gid);
  runCb(g, 'onStart', synthEvent('longpress', { clientX: p.x, clientY: p.y }));
}

function onMove(entry: ElementGestures, e: PointerLike): void {
  const id = pid(e);
  const p = entry.pointers?.get(id);
  if (p) {
    p.x = e.clientX;
    p.y = e.clientY;
  }
  // Tap/LongPress tolerance and Pan are driven by the primary pointer only.
  if (!entry.active || id !== entry.primaryId || !p) return;
  const dx = e.clientX - p.startX;
  const dy = e.clientY - p.startY;
  const distSq = dx * dx + dy * dy;
  const tapMax = tapMaxDistance(entry);
  if (!entry.moved && distSq > tapMax * tapMax) {
    entry.moved = true;
    clearLpTimers(entry); // moved too far to still be a long-press
  }
  const evt = synthEvent('pointermove', e);
  for (const [gid, g] of entry.gestures) {
    if (g.type !== PAN) continue;
    if (!entry.panStarted!.has(gid)) {
      const min = (g.config.minDistance as number) ?? 0;
      if (distSq > min * min && distSq > 0) {
        entry.panStarted!.add(gid);
        runCb(g, 'onStart', evt);
      }
    }
    if (entry.panStarted!.has(gid)) runCb(g, 'onUpdate', evt);
  }
}

function onUp(entry: ElementGestures, e: PointerLike): void {
  const id = pid(e);
  const p = entry.pointers?.get(id);
  entry.pointers?.delete(id);
  if (!entry.active) return;
  // A secondary lift never ends the press — only the primary's does.
  if (id !== entry.primaryId) return;
  entry.active = false;
  clearLpTimers(entry);
  const dx = p ? e.clientX - p.startX : 0;
  const dy = p ? e.clientY - p.startY : 0;
  const tapMax = tapMaxDistance(entry);
  const withinTap = !!p && dx * dx + dy * dy <= tapMax * tapMax;
  const isTap =
    withinTap && !entry.multiTouch && entry.lpFired!.size === 0 && entry.panStarted!.size === 0;
  const evt = synthEvent('pointerup', e);
  // Pass 1: Tap.onStart (emits press) — before onEnd so a LongPress.onEnd
  // press-fallback sees the emit.
  if (isTap) {
    for (const g of entry.gestures.values()) if (g.type === TAP) runCb(g, 'onStart', evt);
  }
  // Pass 2: onEnd for every gesture (resets pressed visual, finishes a pan…).
  for (const g of entry.gestures.values()) runCb(g, 'onEnd', evt);
  resetTransient(entry);
}

function onCancel(entry: ElementGestures, e: PointerLike): void {
  const id = pid(e);
  entry.pointers?.delete(id);
  if (!entry.active) return;
  // A secondary's cancel doesn't end the press either.
  if (id !== entry.primaryId) return;
  entry.active = false;
  clearLpTimers(entry);
  const evt = synthEvent('pointercancel', e);
  for (const g of entry.gestures.values()) runCb(g, 'onEnd', evt);
  resetTransient(entry);
}

function resetTransient(entry: ElementGestures): void {
  entry.primaryId = undefined;
  entry.multiTouch = false;
  entry.moved = false;
  entry.panStarted = undefined;
  entry.lpFired = undefined;
  // `pointers` is NOT cleared — it keeps tracking physically-down stale
  // pointers so no new press starts until they all lift (see onDown).
}

function clearLpTimers(entry: ElementGestures): void {
  if (!entry.lpTimers) return;
  for (const t of entry.lpTimers.values()) clearTimeout(t);
  entry.lpTimers.clear();
}

// ── Callback invocation ──────────────────────────────────────────────────────

function runCb(entry: GestureEntry, name: string, event: unknown): void {
  const cb = entry.callbacks[name];
  if (!cb?._wkltId) return;
  const runWorklet = (globalThis as {
    runWorklet?: (ctx: WorkletCtx, args: unknown[]) => unknown;
  }).runWorklet;
  if (typeof runWorklet !== 'function') return;
  try {
    // Pass the FULL callback ctx — the worklet body also reads `this._jsFn`
    // (the `runOnBackground` handles that emit to BG) and `this._execId`;
    // dropping them throws `Cannot destructure property '_jsFn1'`. runWorklet
    // hydrates the whole ctx (refs, jsFns) before invoking.
    runWorklet(cb, [event]);
  } catch (e) {
    console.log('[sigx-mt] web-gesture callback threw:', name, String(e));
  }
}

/** Largest tap/long-press `maxDistance` across the element's gestures (px). */
function tapMaxDistance(entry: ElementGestures): number {
  let max = DEFAULT_MAX_DISTANCE;
  for (const g of entry.gestures.values()) {
    if ((g.type === TAP || g.type === LONGPRESS) && typeof g.config.maxDistance === 'number') {
      max = Math.max(max, g.config.maxDistance as number);
    }
  }
  return max;
}

/**
 * The `{ params }` event shape the gesture worklet callbacks read. Uses the
 * pointer event's page coordinates (scroll-offset aware) for `pageX/Y`, falling
 * back to client coords when absent (e.g. synthesized long-press point).
 */
function synthEvent(
  type: string,
  e: { clientX: number; clientY: number; pageX?: number; pageY?: number },
): unknown {
  const px = e.pageX ?? e.clientX;
  const py = e.pageY ?? e.clientY;
  return { type, params: { pageX: px, pageY: py, x: e.clientX, y: e.clientY } };
}

function nowMs(): number {
  // Date.now is available on the web MT; avoid performance.now coupling.
  return Date.now();
}

/** Hot-reload / test reset hook. */
export function resetWebGestures(): void {
  for (const entry of byElement.values()) {
    clearLpTimers(entry);
    detachListeners(entry);
  }
  byElement.clear();
}
