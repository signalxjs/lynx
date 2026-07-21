/**
 * Animation orchestration ported from `@lynx-js/motion/dist/mini/core/animate.js`
 * v0.0.3 (Apache-2.0). Spring solver + easeOut math from
 * `motion-dom` v12.23.12 + `motion-utils` v12.23.6 (also Apache-2.0),
 * inlined directly inside the worklet body.
 *
 * Why everything is inlined inside the function: SWC's worklet transform
 * captures any free identifier referenced by the worklet body into the
 * `_c` map. Plain JS function references at module scope (or sibling
 * imports) don't survive JSON serialization across the MT/BG bridge — they
 * arrive on MT as undefined or stringified placeholders. Upstream
 * motion-mini sidesteps this by making every helper its own `'main thread'`
 * worklet (so the placeholder objects survive). For Phase 2.7 we keep the
 * port simpler by inlining the math straight into the `animate` worklet
 * body, with `inflight` cancellation state tucked on `globalThis` so it's
 * not a free-identifier capture.
 *
 * Sigx-specific adaptations:
 *   - Operates on sigx's `SharedValue<number>` (writes `sv.current.value`)
 *     instead of motion's `MotionValue`.
 *   - Per-SharedValue cancellation tracking via `globalThis.__sigxMotionInflight`.
 *   - Uses `globalThis.requestAnimationFrame` (installed by upstream's
 *     worklet-runtime IIFE on MT, Lynx SDK ≥ 2.16); falls back to
 *     `setTimeout(cb, 16)` otherwise.
 *
 * The standalone modules `easings.ts` and `spring.ts` still ship as a
 * pure-math API for non-worklet callers (tests, BG-side debugging). They
 * are NOT imported by this worklet.
 */

import type { SharedValue } from '@sigx/lynx';

// ============================================================================
// Public types
// ============================================================================

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
  restSpeed?: number;
  restDelta?: number;
}

export interface TimingOptions {
  /** Tween duration in seconds. Default 0.3. */
  duration?: number;
}

export interface AnimateOptions extends SpringOptions, TimingOptions {
  type?: 'spring' | 'tween';
}

// Note: motion-style `onUpdate` / `onComplete` / custom `ease` callbacks are
// intentionally NOT in this surface. Function references don't survive
// worklet `_c` capture across the MT/BG bridge — they'd be silent footguns.
// Sigx-native equivalents (zero extra wiring, integrate with reactivity):
//   onUpdate(v) → BG: `effect(() => doX(sv.value))`
//   onComplete() → `await withSpring(sv, target); doNext()`
//   ease: customFn → use a built-in (`linear`, `easeIn`, `easeOut`, etc.);
//     custom curves are rare and would need a `registerEasing(name, fn)`
//     pattern (deferred follow-up).

export interface AnimateControls {
  stop(): void;
  finished: Promise<void>;
}

// ============================================================================
// Public API — all math inlined inside the worklet body.
// ============================================================================

/**
 * Cancel the in-flight animation on `sv`, if any. The SharedValue keeps
 * its current mid-flight value — the caller typically takes over writing
 * it (e.g. a gesture grabbing a sheet during its settle tween). A plain
 * SV write does NOT cancel an animation (only a new `animate()` on the
 * same SV does), so gesture claim paths must call this explicitly.
 */
export function cancelAnimation(sv: SharedValue<number>): void {
  'main thread';

  // Same globalThis stash animate() maintains — module-scope references
  // don't survive SWC's worklet `_c` capture.
  const g = globalThis as { __sigxMotionInflight?: Map<number, () => void> };
  const stop = g.__sigxMotionInflight?.get(sv._wvid);
  if (stop) stop();
}

/**
 * Animate a `SharedValue<number>` toward `target`. Returns
 * `{ stop, finished }`. Default is spring; pass `type: 'tween'` or
 * `{ duration }` to use a tween with `easeOut`.
 */
export function animate(
  sv: SharedValue<number>,
  target: number,
  options: AnimateOptions = {},
): AnimateControls {
  'main thread';

  // ─── Inlined: in-flight cancellation map (per-SharedValue) ──────────
  // Stash on globalThis so SWC doesn't capture a module-scope reference
  // into _c. The map persists across animate() calls on MT.
  const g = globalThis as { __sigxMotionInflight?: Map<number, () => void> };
  if (!g.__sigxMotionInflight) g.__sigxMotionInflight = new Map();
  const inflight = g.__sigxMotionInflight;

  const prev = inflight.get(sv._wvid);
  if (prev) prev();

  const startValue = sv.current.value;

  const isSpring =
    options.type === 'spring' ||
    (options.type !== 'tween' && options.duration == null);

  // ─── Inlined: spring solver (motion-dom port, Apache-2.0) ────────────
  // Returns { next(elapsedMs): { done, value } }. Only built when isSpring.
  const buildSolver = (): ((t: number) => { done: boolean; value: number }) | null => {
    if (!isSpring) return null;

    const stiffness = options.stiffness ?? 100;
    const damping = options.damping ?? 10;
    const mass = options.mass ?? 1;
    const initialVelocity = -((options.velocity ?? 0) / 1000); // ms→s, sign convention

    const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
    const initialDelta = target - startValue;
    const undampedAngularFreq = Math.sqrt(stiffness / mass) / 1000;

    const isGranularScale = Math.abs(initialDelta) < 5;
    const restSpeed = options.restSpeed ?? (isGranularScale ? 0.01 : 2);
    const restDelta = options.restDelta ?? (isGranularScale ? 0.005 : 0.5);

    let resolveSpring: (t: number) => number;

    if (dampingRatio < 1) {
      const angularFreq = undampedAngularFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
      resolveSpring = (t) => {
        const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
        return target - envelope *
          (((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) / angularFreq) *
            Math.sin(angularFreq * t) +
            initialDelta * Math.cos(angularFreq * t));
      };
    } else if (dampingRatio === 1) {
      resolveSpring = (t) =>
        target - Math.exp(-undampedAngularFreq * t) *
          (initialDelta + (initialVelocity + undampedAngularFreq * initialDelta) * t);
    } else {
      const dampedAngularFreq = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
      resolveSpring = (t) => {
        const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
        const freqForT = Math.min(dampedAngularFreq * t, 300);
        return target - (envelope *
          ((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) * Math.sinh(freqForT) +
            dampedAngularFreq * initialDelta * Math.cosh(freqForT))) / dampedAngularFreq;
      };
    }

    // Velocity sample: 5ms-window finite-difference of resolveSpring.
    const calcVelocity = (t: number, current: number): number => {
      const prevT = Math.max(t - 5, 0);
      const prevVal = resolveSpring(prevT);
      const dt = t - prevT;
      return dt ? (current - prevVal) * (1000 / dt) : 0;
    };

    return (t: number) => {
      const current = resolveSpring(t);
      let currentVelocity = t === 0 ? initialVelocity : 0;
      if (dampingRatio < 1) {
        currentVelocity = t === 0 ? initialVelocity * 1000 : calcVelocity(t, current);
      }
      const isBelowVelocityThreshold = Math.abs(currentVelocity) <= restSpeed;
      const isBelowDisplacementThreshold = Math.abs(target - current) <= restDelta;
      const done = isBelowVelocityThreshold && isBelowDisplacementThreshold;
      return { done, value: done ? target : current };
    };
  };

  const solverNext = buildSolver();

  // ─── Inlined: easeOut (cubicBezier(0, 0, 0.58, 1)) ────────────────────
  const calcBezier = (t: number, a1: number, a2: number): number =>
    (((1.0 - 3.0 * a2 + 3.0 * a1) * t + (3.0 * a2 - 6.0 * a1)) * t + 3.0 * a1) * t;

  const binarySubdivide = (x: number, mX1: number, mX2: number): number => {
    let lo = 0, hi = 1, cT = 0, cX: number, i = 0;
    do {
      cT = lo + (hi - lo) / 2;
      cX = calcBezier(cT, mX1, mX2) - x;
      if (cX > 0) hi = cT; else lo = cT;
    } while (Math.abs(cX) > 1e-7 && ++i < 12);
    return cT;
  };

  const easeOutDefault = (t: number): number => {
    if (t === 0 || t === 1) return t;
    return calcBezier(binarySubdivide(t, 0, 0.58), 0, 1);
  };

  const duration = options.duration ?? 0.3;
  const startTime = Date.now();

  let canceled = false;
  let resolvePromise: (() => void) | undefined;
  let settled = false;
  const finished = new Promise<void>((resolve) => { resolvePromise = resolve; });

  const settle = (): void => {
    if (settled) return;
    settled = true;
    if (inflight.get(sv._wvid) === stop) inflight.delete(sv._wvid);
    resolvePromise?.();
  };

  const stop = (): void => {
    if (canceled) return;
    canceled = true;
    settle();
  };

  inflight.set(sv._wvid, stop);

  // ─── Inlined: tick scheduler ──────────────────────────────────────────
  // `globalThis.requestAnimationFrame` is installed by upstream's
  // worklet-runtime IIFE on MT; falls back to `setTimeout(cb, 16)` when
  // unavailable (older SDKs, test environments).
  const rafGlobal = globalThis as { requestAnimationFrame?: (cb: () => void) => void };
  const scheduleNext = (cb: () => void): void => {
    if (typeof rafGlobal.requestAnimationFrame === 'function') {
      rafGlobal.requestAnimationFrame(cb);
    } else {
      setTimeout(cb, 16);
    }
  };

  // ─── Flush trigger (microtask-debounced) ─────────────────────────────
  // We coalesce calls via a `globalThis.__sigxMotionFlushScheduled` flag:
  // multiple ticks across multiple concurrent animations within the same
  // microtask boundary all set the flag, the first one schedules the
  // microtask, the rest see the flag and bail. End result: ONE flush per
  // microtask regardless of how many animations are live. Same pattern
  // upstream's `MTElementWrapper.flushElementTree` uses.
  //
  // The MT runtime now arms this SAME latch on every bridged SharedValue
  // write (`animated-bridge-mt.ts: armAvAutoFlush` — the `sv.current.value`
  // assignment in tick() below already schedules the flush through it), so
  // this explicit trigger is belt-and-braces: it keeps animations flushing
  // when lynx-motion is paired with an older runtime-main that doesn't arm
  // the setter, and costs nothing otherwise (the shared latch dedupes).
  const flushTree = (): void => {
    const g = globalThis as Record<string, unknown>;
    if (g['__sigxMotionFlushScheduled']) return;
    g['__sigxMotionFlushScheduled'] = true;
    Promise.resolve().then(() => {
      g['__sigxMotionFlushScheduled'] = false;
      const fn = g['__FlushElementTree'] as (() => void) | undefined;
      if (fn) fn();
    });
  };

  const tick = (): void => {
    if (canceled) return;

    const now = Date.now();
    const elapsedMs = now - startTime;
    const elapsedSec = elapsedMs / 1000;

    let current: number;
    let done: boolean;

    if (solverNext) {
      const state = solverNext(elapsedMs);
      current = state.value;
      done = state.done;
    } else if (elapsedSec >= duration) {
      current = target;
      done = true;
    } else {
      const p = elapsedSec / duration;
      current = startValue + (target - startValue) * easeOutDefault(p);
      done = false;
    }

    sv.current.value = current;
    flushTree();

    if (done) {
      if (!solverNext && sv.current.value !== target) {
        sv.current.value = target;
        flushTree();
      }
      settle();
    } else {
      scheduleNext(tick);
    }
  };

  scheduleNext(tick);

  return { stop, finished };
}

/** Test hook — clear the in-flight map. Not part of the public API. */
export function _resetInflight(): void {
  const g = globalThis as { __sigxMotionInflight?: Map<number, () => void> };
  if (g.__sigxMotionInflight) g.__sigxMotionInflight.clear();
}
