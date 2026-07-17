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
 * Supported: **Tap**, **LongPress**, **Pan**, **Fling**, **Pinch**, **Rotation**.
 * Arena relations (waitFor/simultaneous/continueWith) are not implemented —
 * composed gestures still drive every base's lifecycle (e.g. `Pressable`'s
 * `Simultaneous(Tap, LongPress)` resets its visual in `LongPress.onEnd`).
 *
 * Pinch/Rotation pair the first two concurrent pointers: `onStart` fires when
 * the second lands (scale 1 / rotation 0), `onUpdate` on either's move, and a
 * dedicated `onEnd` with final values when either lifts — the universal
 * end-of-press onEnd pass then skips them (exactly one onEnd per press; when no
 * pair ever formed the universal pass covers them as before). Payloads follow
 * the legacy `usePinch`/`useRotation` hooks: pinch `params.scale` =
 * currentDistance/baseDistance; rotation `params.rotation` = cumulative signed
 * **radians** (unwrapped across ±π, unlike the hooks) + `params.velocity` in
 * rad/ms; both carry `focalX/focalY` (page coords of the midpoint, mirrored
 * into pageX/pageY, with client coords in x/y). The native arena's
 * Pinch/Rotation handlers are unfinished (#418) — this payload is the contract
 * native should converge on. No mid-press re-pairing with a third finger.
 *
 * Fling is discrete: recognized at the primary pointer's `pointerup` from the
 * velocity over a trailing ~100ms sample window — `onStart` fires on a match
 * (with `params.velocityX/velocityY` in px/ms), then the universal `onEnd` pass
 * runs as for every gesture. No `onUpdate`. Velocity unit is **px/ms** (0.3
 * px/ms = 300 px/s), matching how consumers compute drag velocity manually.
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
const FLING = 1;
const TAP = 3;
const LONGPRESS = 4;
const ROTATION = 5;
const PINCH = 6;

const DEFAULT_MAX_DISTANCE = 10; // px — tap/long-press movement tolerance
const DEFAULT_LONGPRESS_MS = 500;
/** Fling `minVelocity` default, px/ms (≈ 300 px/s). */
const DEFAULT_FLING_MIN_VELOCITY = 0.3;
/** Only samples this recent (ms before the up) feed the fling velocity. */
const FLING_SAMPLE_WINDOW_MS = 100;
/** Ring-buffer cap for velocity samples on the primary pointer. */
const FLING_MAX_SAMPLES = 8;

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
  /** Last page coords (fall back to client when the event lacks them). */
  px: number;
  py: number;
  /**
   * Trailing movement samples for fling velocity (primary pointer only, and
   * only while a Fling gesture is registered). Capped at FLING_MAX_SAMPLES.
   */
  samples?: { x: number; y: number; t: number }[];
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
  /** Two-finger pair driving Pinch/Rotation (formed when the 2nd pointer lands). */
  pair?: {
    aId: number;
    bId: number;
    baseDistance: number;
    /** Last raw inter-finger angle — for smallest-signed-delta unwrapping. */
    prevAngle: number;
    /** Accumulated signed rotation (radians), unwrapped across ±π. */
    rotation: number;
    prevT: number;
    /** Last measured angular velocity (rad/ms) — reported at pair end when the
     * final event carries no fresh movement (matches `useRotation`). */
    velocity: number;
  };
  /** Pinch/Rotation already got their dedicated onEnd this press. */
  pairEnded?: boolean;
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
  // Fling too (browser claims the fast swipe for scrolling) and Pinch/Rotation
  // (browser claims two-finger contact for page zoom). Axis-aware touch-action
  // derivation is a follow-up.
  if (needsTouchActionNone(type)) setTouchActionNone(entry);
}

function needsTouchActionNone(type: number): boolean {
  return type === PAN || type === FLING || type === PINCH || type === ROTATION;
}

/** Remove one gesture; tear down listeners when the element has none left. */
export function unregisterWebGesture(elementWvid: number, gestureId: number): void {
  const entry = byElement.get(elementWvid);
  if (!entry) return;
  entry.gestures.delete(gestureId);
  // Restore `touch-action` as soon as no gesture needing it remains — even if
  // other gestures stay on the element — so a removed drag doesn't leave the
  // element stuck unscrollable.
  let needs = false;
  for (const g of entry.gestures.values()) if (needsTouchActionNone(g.type)) needs = true;
  if (!needs) restoreTouchAction(entry);
  if (entry.gestures.size > 0) return;
  clearLpTimers(entry);
  detachListeners(entry);
  byElement.delete(elementWvid);
}

function hasType(entry: ElementGestures, type: number): boolean {
  for (const g of entry.gestures.values()) if (g.type === type) return true;
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

/**
 * Sync the event's coords into its tracked PointerState (move, up AND cancel —
 * a lift can land at a position no `pointermove` ever reported, and the final
 * Pinch/Rotation payload must see it).
 */
function syncPointer(entry: ElementGestures, e: PointerLike): PointerState | undefined {
  const p = entry.pointers?.get(pid(e));
  if (p) {
    p.x = e.clientX;
    p.y = e.clientY;
    p.px = e.pageX ?? e.clientX;
    p.py = e.pageY ?? e.clientY;
  }
  return p;
}

function onDown(entry: ElementGestures, e: PointerLike): void {
  const id = pid(e);
  const pointers = (entry.pointers ??= new Map());
  // Never overwrite an already-tracked pointer: on hosts that omit `pointerId`
  // every down normalizes to 0, and clobbering the entry would reset the
  // primary's start coords mid-press (the exact bug this rework removes).
  const known = pointers.has(id);
  if (!known) {
    pointers.set(id, {
      startX: e.clientX,
      startY: e.clientY,
      startT: nowMs(),
      x: e.clientX,
      y: e.clientY,
      px: e.pageX ?? e.clientX,
      py: e.pageY ?? e.clientY,
    });
  }
  // Capture so move/up keep flowing to this element even outside its bounds.
  if (e.pointerId != null) {
    try {
      (entry.el as unknown as DomEl).setPointerCapture?.(e.pointerId);
    } catch {
      /* capture unsupported — drag tracking degrades to in-bounds only */
    }
  }

  if (entry.active) {
    // A repeated down for a pointer we already track isn't a new contact —
    // ignore it (it must not flip the press to multi-touch).
    if (known) return;
    // Secondary contact during an active press: the press becomes multi-touch,
    // which disqualifies Tap (checked in onUp) and cancels pending LongPress
    // timers — mirroring the native recognizers failing on a second touch. No
    // re-fired onBegin; the press's lifecycle stays owned by the primary.
    entry.multiTouch = true;
    clearLpTimers(entry);
    // Exactly two pointers now down and no pair yet this press → pair them for
    // Pinch/Rotation. A third finger never re-pairs mid-press.
    if (!entry.pair && !entry.pairEnded && pointers.size === 2) formPair(entry, id);
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
  if (hasType(entry, FLING)) {
    const p = pointers.get(id);
    if (p) p.samples = [{ x: e.clientX, y: e.clientY, t: p.startT }];
  }
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

// ── Two-finger pair (Pinch / Rotation) ─────────────────────────────────────

/** Smallest signed angular difference `to - from`, normalized to (-π, π]. */
function angleDeltaSigned(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Pair the primary with the just-landed pointer; fire Pinch/Rotation onStart. */
function formPair(entry: ElementGestures, secondId: number): void {
  if (!hasType(entry, PINCH) && !hasType(entry, ROTATION)) return;
  const aId = entry.primaryId!;
  const a = entry.pointers!.get(aId);
  const b = entry.pointers!.get(secondId);
  if (!a || !b) return;
  entry.pair = {
    aId,
    bId: secondId,
    baseDistance: Math.hypot(b.x - a.x, b.y - a.y),
    prevAngle: Math.atan2(b.y - a.y, b.x - a.x),
    rotation: 0,
    prevT: nowMs(),
    velocity: 0,
  };
  for (const g of entry.gestures.values()) {
    if (g.type === PINCH) runCb(g, 'onStart', pinchEvent(a, b, 1));
    else if (g.type === ROTATION) runCb(g, 'onStart', rotationEvent(a, b, 0, 0));
  }
}

/**
 * Fold the pair's current geometry into its accumulated state: unwrapped
 * rotation (smallest signed delta across ±π — the legacy hooks cap at ±π; we
 * don't), angular velocity, and scale. Shared by onUpdate and pair end so the
 * final event never misses movement that arrived only with the up/cancel.
 */
function advancePair(
  entry: ElementGestures,
): { a: PointerState; b: PointerState; scale: number } | undefined {
  const pair = entry.pair!;
  const a = entry.pointers!.get(pair.aId);
  const b = entry.pointers!.get(pair.bId);
  if (!a || !b) return undefined;
  const t = nowMs();
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const delta = angleDeltaSigned(pair.prevAngle, angle);
  pair.rotation += delta;
  // Keep the last *measured* velocity when this step carries no fresh movement
  // (e.g. an up at the last move's position) — matches `useRotation`, whose
  // 'ended' state retains the last active velocity.
  if (delta !== 0) pair.velocity = delta / Math.max(t - pair.prevT, 1);
  pair.prevAngle = angle;
  pair.prevT = t;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return { a, b, scale: pair.baseDistance > 0 ? dist / pair.baseDistance : 1 };
}

/** Recompute distance/angle after a pair member moved; fire onUpdate. */
function updatePair(entry: ElementGestures): void {
  const pair = entry.pair!;
  const s = advancePair(entry);
  if (!s) return;
  for (const g of entry.gestures.values()) {
    if (g.type === PINCH) runCb(g, 'onUpdate', pinchEvent(s.a, s.b, s.scale));
    else if (g.type === ROTATION)
      runCb(g, 'onUpdate', rotationEvent(s.a, s.b, pair.rotation, pair.velocity));
  }
}

/**
 * A pair member lifted/cancelled: fire the dedicated Pinch/Rotation onEnd with
 * final values (the caller synced the up/cancel coords into PointerState
 * first, and `advancePair` folds in that last movement) and mark them done —
 * the universal end-of-press onEnd pass then skips them so each fires exactly
 * once per press.
 */
function endPair(entry: ElementGestures): void {
  const pair = entry.pair!;
  const s = advancePair(entry);
  entry.pair = undefined;
  entry.pairEnded = true;
  if (!s) return;
  for (const g of entry.gestures.values()) {
    if (g.type === PINCH) runCb(g, 'onEnd', pinchEvent(s.a, s.b, s.scale));
    else if (g.type === ROTATION)
      runCb(g, 'onEnd', rotationEvent(s.a, s.b, pair.rotation, pair.velocity));
  }
}

/** Focal-point event params shared by Pinch and Rotation. */
function pairParams(a: PointerState, b: PointerState): Record<string, number> {
  const fpx = (a.px + b.px) / 2;
  const fpy = (a.py + b.py) / 2;
  return {
    pageX: fpx,
    pageY: fpy,
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    focalX: fpx,
    focalY: fpy,
  };
}

function pinchEvent(a: PointerState, b: PointerState, scale: number): unknown {
  return { type: 'pinch', params: { ...pairParams(a, b), scale } };
}

function rotationEvent(
  a: PointerState,
  b: PointerState,
  rotation: number,
  velocity: number,
): unknown {
  return { type: 'rotation', params: { ...pairParams(a, b), rotation, velocity } };
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
  const p = syncPointer(entry, e);
  // Pinch/Rotation are driven by BOTH pair members' moves.
  if (entry.active && entry.pair && p && (id === entry.pair.aId || id === entry.pair.bId)) {
    updatePair(entry);
  }
  // Tap/LongPress tolerance and Pan are driven by the primary pointer only.
  if (!entry.active || id !== entry.primaryId || !p) return;
  if (p.samples) {
    p.samples.push({ x: e.clientX, y: e.clientY, t: nowMs() });
    if (p.samples.length > FLING_MAX_SAMPLES) p.samples.shift();
  }
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
  const p = syncPointer(entry, e);
  // Either pair member lifting ends the Pinch/Rotation (after syncing the up
  // coords, before the pointer is dropped from the map, so the final
  // focal/scale/rotation see the true release positions).
  if (entry.active && entry.pair && (id === entry.pair.aId || id === entry.pair.bId)) {
    endPair(entry);
  }
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
  // Fling pass: velocity over the primary pointer's trailing sample window.
  // Discrete — onStart on a match, then the universal onEnd below.
  let flung = false;
  const v = p ? flingVelocity(p, e, nowMs()) : undefined;
  if (v) {
    for (const g of entry.gestures.values()) {
      if (g.type === FLING && flingMatches(g.config, v.vx, v.vy)) {
        flung = true;
        runCb(g, 'onStart', flingEvent(e, v.vx, v.vy));
      }
    }
  }
  // Pass 1: Tap.onStart (emits press) — before onEnd so a LongPress.onEnd
  // press-fallback sees the emit. A recognized fling suppresses the tap
  // explicitly: a very short, very fast flick can clear `minVelocity` while
  // still inside the tap tolerance, and must not fire both.
  if (isTap && !flung) {
    for (const g of entry.gestures.values()) if (g.type === TAP) runCb(g, 'onStart', evt);
  }
  // Pass 2: onEnd for every gesture (resets pressed visual, finishes a pan…).
  // Pinch/Rotation are skipped when their dedicated pair-end already fired.
  for (const g of entry.gestures.values()) {
    if (entry.pairEnded && (g.type === PINCH || g.type === ROTATION)) continue;
    runCb(g, 'onEnd', evt);
  }
  resetTransient(entry);
}

function onCancel(entry: ElementGestures, e: PointerLike): void {
  const id = pid(e);
  syncPointer(entry, e);
  // A cancelled pair member ends the Pinch/Rotation, like a lift.
  if (entry.active && entry.pair && (id === entry.pair.aId || id === entry.pair.bId)) {
    endPair(entry);
  }
  entry.pointers?.delete(id);
  if (!entry.active) return;
  // A secondary's cancel doesn't end the press either.
  if (id !== entry.primaryId) return;
  entry.active = false;
  clearLpTimers(entry);
  const evt = synthEvent('pointercancel', e);
  for (const g of entry.gestures.values()) {
    if (entry.pairEnded && (g.type === PINCH || g.type === ROTATION)) continue;
    runCb(g, 'onEnd', evt);
  }
  resetTransient(entry);
}

function resetTransient(entry: ElementGestures): void {
  entry.primaryId = undefined;
  entry.multiTouch = false;
  entry.moved = false;
  entry.panStarted = undefined;
  entry.lpFired = undefined;
  entry.pair = undefined;
  entry.pairEnded = false;
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

/**
 * Velocity (px/ms) over the trailing FLING_SAMPLE_WINDOW_MS of the primary
 * pointer's samples, measured to the pointerup position. Undefined when there
 * are no samples or no time has elapsed. A pause before release naturally
 * fails the threshold: the newest sample is old, so velocity ≈ 0.
 */
function flingVelocity(
  p: PointerState,
  e: PointerLike,
  t: number,
): { vx: number; vy: number } | undefined {
  const samples = p.samples;
  if (!samples || samples.length === 0) return undefined;
  const cutoff = t - FLING_SAMPLE_WINDOW_MS;
  // Earliest sample still inside the window; if all are older (finger paused),
  // fall back to the newest so the long dt yields a near-zero velocity.
  let base = samples[samples.length - 1]!;
  for (const s of samples) {
    if (s.t >= cutoff) {
      base = s;
      break;
    }
  }
  const dt = t - base.t;
  if (dt <= 0) return undefined;
  return { vx: (e.clientX - base.x) / dt, vy: (e.clientY - base.y) / dt };
}

/**
 * Does the velocity satisfy this Fling's `direction` + `minVelocity` config?
 * Directional flings require the configured axis to dominate and its component
 * to clear the threshold; direction-less flings use the overall magnitude.
 * Units: px/ms.
 */
function flingMatches(config: Record<string, unknown>, vx: number, vy: number): boolean {
  const min =
    typeof config.minVelocity === 'number' ? config.minVelocity : DEFAULT_FLING_MIN_VELOCITY;
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  switch (config.direction as string | undefined) {
    case 'left':
      return vx < 0 && ax >= ay && ax >= min;
    case 'right':
      return vx > 0 && ax >= ay && ax >= min;
    case 'up':
      return vy < 0 && ay >= ax && ay >= min;
    case 'down':
      return vy > 0 && ay >= ax && ay >= min;
    default:
      return Math.hypot(vx, vy) >= min;
  }
}

/** Fling onStart event: the usual coord params plus velocity in px/ms. */
function flingEvent(e: PointerLike, vx: number, vy: number): unknown {
  const evt = synthEvent('fling', e) as { type: string; params: Record<string, number> };
  evt.params.velocityX = vx;
  evt.params.velocityY = vy;
  return evt;
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
