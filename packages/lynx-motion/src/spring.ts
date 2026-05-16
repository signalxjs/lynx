/**
 * Spring solver ported from `motion-dom` v12.23.12 + `motion-utils` v12.23.6
 * (both Apache-2.0).
 * Upstream:
 *   - https://github.com/motiondivision/motion/tree/main/packages/motion-dom/src/animation/generators/spring
 *   - https://github.com/motiondivision/motion/tree/main/packages/motion-utils/src
 *
 * Sigx adaptation:
 *   - Inlined the motion-utils helpers we depend on (`clamp`,
 *     `millisecondsToSeconds`, `secondsToMilliseconds`, `velocityPerSecond`)
 *     and the velocity calculator from `motion-dom/animation/generators/utils`.
 *     These are tiny pure functions; inlining keeps `@sigx/lynx-motion` zero-deps
 *     beyond the sigx workspace.
 *   - Skipped the duration→physics resolution path (motion's `findSpring`).
 *     Phase 2.7 ships only physics-based options (stiffness/damping/mass).
 *     If a future user wants `withSpring(av, target, { duration, bounce })`,
 *     add `findSpring` then.
 *   - `calculatedDuration` and `toString()` / `toTransition()` from upstream
 *     are dropped; they're for WAAPI integration which Lynx doesn't use.
 *
 * Verbatim translation of the integrator math; any divergence is a bug.
 */

// ---- inlined helpers ------------------------------------------------------

const clamp = (min: number, max: number, v: number): number =>
  v > max ? max : v < min ? min : v;

const millisecondsToSeconds = (ms: number): number => ms / 1000;
const secondsToMilliseconds = (s: number): number => s * 1000;

const velocityPerSecond = (velocity: number, frameDuration: number): number =>
  frameDuration ? velocity * (1000 / frameDuration) : 0;

const velocitySampleDuration = 5; // ms
const calcGeneratorVelocity = (
  resolveValue: (t: number) => number,
  t: number,
  current: number,
): number => {
  const prevT = Math.max(t - velocitySampleDuration, 0);
  return velocityPerSecond(current - resolveValue(prevT), t - prevT);
};

// ---- defaults -------------------------------------------------------------

const springDefaults = {
  stiffness: 100,
  damping: 10,
  mass: 1.0,
  velocity: 0.0,
  restSpeed: { granular: 0.01, default: 2 },
  restDelta: { granular: 0.005, default: 0.5 },
};

// ---- public API -----------------------------------------------------------

export interface SpringOptions {
  /** Spring physics. Default 100. */
  stiffness?: number;
  /** Spring damping. Default 10. */
  damping?: number;
  /** Mass of the spring object. Default 1. */
  mass?: number;
  /** Initial velocity in units/sec. Default 0. */
  velocity?: number;
  /** Threshold below which the spring is considered at rest. */
  restSpeed?: number;
  restDelta?: number;
}

export interface SpringStep {
  done: boolean;
  value: number;
}

export interface SpringSolver {
  /**
   * Advance the spring to `t` ms after `t=0`. Returns the integrated value
   * and a `done` flag set when the spring is below the rest thresholds.
   */
  next(t: number): SpringStep;
}

export interface SpringSolverOptions extends SpringOptions {
  /** Required: `[origin, target]`. Pinned to a 2-element keyframes shape. */
  keyframes: [number, number];
}

/**
 * Build a spring solver. Call `.next(elapsedMs)` repeatedly to step the
 * animation. The solver owns no time state — call `.next` with the current
 * elapsed time each tick (motion's pattern).
 */
export function spring(options: SpringSolverOptions): SpringSolver {
  const origin = options.keyframes[0];
  const target = options.keyframes[1];

  const state: SpringStep = { done: false, value: origin };

  const stiffness = options.stiffness ?? springDefaults.stiffness;
  const damping = options.damping ?? springDefaults.damping;
  const mass = options.mass ?? springDefaults.mass;
  // Negate to match motion's convention: positive velocity moves toward
  // target, but the integrator expects velocity in source-units convention.
  const initialVelocity = -millisecondsToSeconds(options.velocity ?? 0);

  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const initialDelta = target - origin;
  const undampedAngularFreq = millisecondsToSeconds(
    Math.sqrt(stiffness / mass),
  );

  const isGranularScale = Math.abs(initialDelta) < 5;
  const restSpeed =
    options.restSpeed ??
    (isGranularScale
      ? springDefaults.restSpeed.granular
      : springDefaults.restSpeed.default);
  const restDelta =
    options.restDelta ??
    (isGranularScale
      ? springDefaults.restDelta.granular
      : springDefaults.restDelta.default);

  let resolveSpring: (t: number) => number;

  if (dampingRatio < 1) {
    // Underdamped — oscillates while decaying.
    const angularFreq =
      undampedAngularFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
    resolveSpring = (t) => {
      const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
      return (
        target -
        envelope *
          (((initialVelocity +
            dampingRatio * undampedAngularFreq * initialDelta) /
            angularFreq) *
            Math.sin(angularFreq * t) +
            initialDelta * Math.cos(angularFreq * t))
      );
    };
  } else if (dampingRatio === 1) {
    // Critically damped — fastest non-oscillating return.
    resolveSpring = (t) =>
      target -
      Math.exp(-undampedAngularFreq * t) *
        (initialDelta +
          (initialVelocity + undampedAngularFreq * initialDelta) * t);
  } else {
    // Overdamped — slow non-oscillating return.
    const dampedAngularFreq =
      undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
    resolveSpring = (t) => {
      const envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
      // Cap freq*t to keep sinh/cosh from hitting Infinity.
      const freqForT = Math.min(dampedAngularFreq * t, 300);
      return (
        target -
        (envelope *
          ((initialVelocity +
            dampingRatio * undampedAngularFreq * initialDelta) *
            Math.sinh(freqForT) +
            dampedAngularFreq * initialDelta * Math.cosh(freqForT))) /
          dampedAngularFreq
      );
    };
  }

  return {
    next(t: number): SpringStep {
      const current = resolveSpring(t);

      let currentVelocity = t === 0 ? initialVelocity : 0.0;
      // Velocity calc only needed for underdamped — over/critically-damped
      // can't overshoot, so position alone tells us we're done.
      if (dampingRatio < 1) {
        currentVelocity =
          t === 0
            ? secondsToMilliseconds(initialVelocity)
            : calcGeneratorVelocity(resolveSpring, t, current);
      }

      const isBelowVelocityThreshold = Math.abs(currentVelocity) <= restSpeed;
      const isBelowDisplacementThreshold =
        Math.abs(target - current) <= restDelta;

      state.done = isBelowVelocityThreshold && isBelowDisplacementThreshold;
      state.value = state.done ? target : current;
      return state;
    },
  };
}

// Re-export `clamp` because it's small and useful for animation math, and
// motion-mini exports it from its mini surface.
export { clamp };
