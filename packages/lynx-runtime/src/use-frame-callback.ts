/**
 * Per-frame main-thread callbacks (#933).
 *
 * The runtime had no per-frame API at all. Anything that needs one — a physics
 * simulation, a game loop, an inertial settle, a custom easing that has to see
 * every frame — had to hand-roll a self-recursive `requestAnimationFrame`
 * chain inside a worklet body and guard it with a `MainThreadRef` flag
 * (`@sigx/lynx-gestures`' `Draggable` edge-scroll tick is the in-repo
 * example). `useFrameCallback` registers the worklet ONCE and lets the MT
 * drive it.
 *
 * ### Why registration is separate from invocation
 *
 * Upstream's `runWorklet` caches its hydration work in a `WeakMap` keyed on
 * the ctx object's IDENTITY. Reusing the per-call `INVOKE_WORKLET` path
 * (`runOnMainThread`) would hand it a freshly-built `{_wkltId, _c}` every
 * frame, so every frame would pay a full `_c` walk, a new bound function and
 * a new `WeakRef` — and, for any `runOnBackground` handle inside the body, a
 * fresh `addRef(execId, …)` into upstream's `FinalizationRegistry` sixty
 * times a second, climbing its refcount without bound and firing a
 * `releaseBackgroundWorkletCtx` dispatch storm at BG on GC. So the ctx
 * crosses the bridge once and the MT keeps the object.
 *
 * ### Why activation is a separate op
 *
 * Because it must be reachable from the MAIN thread. A flick's `onEnd` has
 * the release velocity in hand on the MT and needs the simulation running in
 * that same frame — a BG round trip to call `start()` would cost a frame and
 * a thread hop. {@link startFrameCallback} / {@link stopFrameCallback} are
 * themselves `'main thread'` worklets, so a gesture callback can flip the
 * flag directly. Folding activation into a re-REGISTER would also mint a
 * fresh ctx object and defeat the hydration cache above.
 *
 * @example A physics settle started by the gesture that caused it
 * ```tsx
 * const pos = useSharedValue(0);
 * const vel = useMainThreadRef({ v: 0 });
 *
 * const sim = useFrameCallback((frame) => {
 *   'main thread';
 *   const dt = frame.timeSincePreviousFrame / 1000;
 *   vel.current.v *= 0.94;
 *   pos.current.value += vel.current.v * dt;
 *   if (Math.abs(vel.current.v) < 1) stopFrameCallback(sim);
 * });
 *
 * const fling = Gesture.Pan()
 *   .onBegin(() => { 'main thread'; })     // iOS: without this, onEnd never fires
 *   .onEnd(() => {
 *     'main thread';
 *     vel.current.v = releaseVelocity;
 *     startFrameCallback(sim);             // MT → MT, no round trip
 *   });
 *
 * useAnimatedStyle(elRef, pos, 'translateX');
 * ```
 */

import { onUnmounted } from '@sigx/runtime-core';
import { OP } from '@sigx/lynx-runtime-internal';

import { pushOp, scheduleFlush } from './op-queue.js';
import { sanitizeCaptured } from './main-thread-ref.js';
import { registerWorkletCtx } from './run-on-background.js';

/**
 * Timing handed to a frame callback. All values derive from `Date.now()`
 * deltas — upstream's main-thread `requestAnimationFrame` does not reliably
 * pass a timestamp argument, and `performance.now()` does not exist on the
 * main thread (`lynx.performance` is the profiling surface, not a clock).
 *
 * That means ~1ms granularity, i.e. roughly ±6% on a 16.7ms frame. Fine for
 * driving an integrator; not a basis for reporting sub-millisecond timings.
 */
export interface FrameInfo {
  /** `Date.now()` sampled once per frame and shared by every callback in it. */
  timestamp: number;
  /** Milliseconds since this run started. `0` on the run's first frame. */
  timeSinceFirstFrame: number;
  /**
   * Milliseconds since this callback's previous frame. `0` on the first frame
   * of a run, and clamped to `>= 0` — so an integrator can never be handed a
   * negative `dt` when the wall clock steps backwards.
   */
  timeSincePreviousFrame: number;
  /** 1-based, reset on every inactive → active transition. */
  frameNumber: number;
}

export interface FrameCallbackOptions {
  /** Start ticking as soon as the registration lands on the MT. Default `false`. */
  autostart?: boolean;
}

export interface FrameCallback {
  /**
   * Wire id. This is the ONLY field that survives capture into a worklet's
   * `_c` (the methods are dropped by `JSON.stringify`), which is what makes
   * `startFrameCallback(fc)` work from inside another worklet.
   *
   * @internal
   */
  readonly _fcid: number;
  /** Begin ticking. Idempotent. Call from the background thread. */
  start(): void;
  /** Stop ticking. Idempotent; does not unregister. Call from the background thread. */
  stop(): void;
  /**
   * Unregister permanently. Idempotent, and called automatically on unmount.
   * Public because `onUnmounted` no-ops outside a component setup, so a
   * module-scope or manually-managed loop needs a way to release its MT entry.
   */
  dispose(): void;
}

/** The placeholder shape the SWC transform leaves behind for a `'main thread'` function. */
interface FrameWorkletCtx {
  _wkltId: string;
  _c?: Record<string, unknown>;
  _jsFn?: Record<string, unknown>;
  _execId?: number;
  _workletType?: string;
  [key: string]: unknown;
}

let nextFcId = 1;

/** Reset hook for tests. */
export function resetFrameCallbackIds(): void {
  nextFcId = 1;
}

/**
 * Run a `'main thread'` worklet once per frame.
 *
 * The MT drives ONE `requestAnimationFrame` chain for every registered
 * callback, so N callbacks cost one host rAF call per frame, all see the same
 * `timestamp`, and the frame closes with a single `__FlushElementTree()`.
 *
 * A callback that throws is contained (siblings still run, the chain
 * continues) and logged at most once per 60 consecutive throwing frames. It
 * is deliberately NOT auto-stopped: silently killing a loop the caller
 * explicitly started is the worse failure mode.
 *
 * @param worklet A function carrying the `'main thread'` directive.
 * @param options `{ autostart: true }` to begin ticking on registration.
 */
export function useFrameCallback(
  worklet: (frame: FrameInfo) => void,
  options?: FrameCallbackOptions,
): FrameCallback {
  // By the time the runtime sees the value, the SWC LEPUS transform has
  // already replaced the source-level function with a placeholder. A plain
  // function here means the worklet transform never ran — the body would be
  // unreachable on the MT, so fail loudly rather than tick forever doing
  // nothing.
  const placeholder = worklet as unknown as FrameWorkletCtx;
  if (
    typeof placeholder !== 'object'
    || placeholder === null
    || typeof placeholder._wkltId !== 'string'
  ) {
    throw new Error(
      '[@sigx/lynx-runtime] useFrameCallback: the argument is not a main-thread worklet. '
      + "Add the 'main thread' directive as the first statement of the callback, and check "
      + "that @sigx/lynx-plugin's worklet transform is applied to this file.",
    );
  }

  const fcid = nextFcId++;

  // Ship the FULL transform-emitted ctx: the MT hands it to `runWorklet`
  // verbatim, and dropping `_jsFn` / `_execId` breaks hydration with
  // "Cannot destructure property '_jsFn1'". Spread first so every field
  // survives, then sanitize `_c` (MainThreadRef → `{_wvid,_initValue}`) so
  // captures survive the JSON round trip.
  const ctx: FrameWorkletCtx = { ...placeholder };
  if (ctx._c) ctx._c = sanitizeCaptured(ctx._c);
  ctx._workletType = 'main-thread';
  // Stamps `_execId` so `runOnBackground(...)` inside the frame body resolves.
  registerWorkletCtx(ctx);

  pushOp(OP.REGISTER_FRAME_CALLBACK, fcid, ctx, options?.autostart === true ? 1 : 0);
  scheduleFlush();

  let disposed = false;

  const setActive = (active: boolean): void => {
    if (disposed) return;
    // Deliberately not deduped against a BG-side mirror: the MT can flip this
    // flag on its own (`stopFrameCallback` from inside the worklet), so BG's
    // idea of the current state can be stale — and a mirror would swallow
    // exactly the `start()` that is meant to resume a self-stopped loop. The
    // op is three numbers, and the MT-side setter is idempotent.
    pushOp(OP.SET_FRAME_CALLBACK_ACTIVE, fcid, active ? 1 : 0);
    scheduleFlush();
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    pushOp(OP.UNREGISTER_FRAME_CALLBACK, fcid);
    scheduleFlush();
  };

  onUnmounted(dispose);

  return {
    _fcid: fcid,
    start: () => setActive(true),
    stop: () => setActive(false),
    dispose,
  };
}

/**
 * Start a frame callback from **inside another main-thread worklet** — a
 * gesture's `onEnd`, a tap handler, or the frame callback itself.
 *
 * This is the whole reason activation is decoupled from registration: the
 * release velocity of a flick exists on the MT, and the simulation should be
 * running in that same frame rather than after a BG round trip.
 *
 * Main-thread only. Calling it from background code hits the untransformed
 * placeholder and throws — same contract as `measureViewportRect`.
 */
export function startFrameCallback(fc: FrameCallback): void {
  'main thread';
  // Read off `globalThis` rather than importing: SWC captures free
  // identifiers into `_c` and JSON-serializes them, so a module-scope
  // function reference would arrive as `undefined`. `fc` itself survives as
  // `{_fcid}` — the methods are dropped by JSON, the id is all we need.
  const g = globalThis as {
    __sigxFrameCallbacks?: { setActive: (id: number, active: boolean) => void };
  };
  const api = g.__sigxFrameCallbacks;
  if (api) api.setActive(fc._fcid, true);
}

/**
 * Stop a frame callback from **inside another main-thread worklet** — most
 * often the callback itself, once the simulation it drives has settled.
 *
 * Main-thread only; see {@link startFrameCallback}.
 */
export function stopFrameCallback(fc: FrameCallback): void {
  'main thread';
  const g = globalThis as {
    __sigxFrameCallbacks?: { setActive: (id: number, active: boolean) => void };
  };
  const api = g.__sigxFrameCallbacks;
  if (api) api.setActive(fc._fcid, false);
}
