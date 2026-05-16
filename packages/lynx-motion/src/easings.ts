/**
 * Easing functions ported from `motion-utils` v12.23.6 (Apache-2.0).
 * Upstream: https://github.com/motiondivision/motion/tree/main/packages/motion-utils/src/easing
 *
 * Sigx adaptation:
 *   - Inlined into a single file (cubic-bezier + modifiers + named easings).
 *   - No `'main thread'` directive; these are pure math functions safe to
 *     call from BG or MT context. Sigx's tween path on MT calls them
 *     directly inside the worklet body.
 *
 * Reference for individual implementations:
 *   - cubicBezier: motion-utils/src/easing/cubic-bezier.ts (modified from
 *     Gaëtan Renaudeau's BezierEasing — https://github.com/gre/bezier-easing,
 *     MIT-licensed)
 *   - ease.ts, back.ts, circ.ts, anticipate.ts, modifiers/{mirror,reverse}.ts
 *
 * Verbatim translation; any divergence from upstream is a bug.
 */

export type Easing = (t: number) => number;

// noop — identity; serves as `linear` and as the cubic-bezier shortcut when
// (mX1, mY1) === (mX2, mY2).
const noop: Easing = (t) => t;

// ---- cubic bezier ---------------------------------------------------------

const calcBezier = (t: number, a1: number, a2: number): number =>
  (((1.0 - 3.0 * a2 + 3.0 * a1) * t + (3.0 * a2 - 6.0 * a1)) * t + 3.0 * a1) *
  t;

const subdivisionPrecision = 0.0000001;
const subdivisionMaxIterations = 12;

function binarySubdivide(
  x: number,
  lowerBound: number,
  upperBound: number,
  mX1: number,
  mX2: number,
): number {
  let currentX: number;
  let currentT: number = 0;
  let i = 0;
  do {
    currentT = lowerBound + (upperBound - lowerBound) / 2.0;
    currentX = calcBezier(currentT, mX1, mX2) - x;
    if (currentX > 0.0) {
      upperBound = currentT;
    } else {
      lowerBound = currentT;
    }
  } while (
    Math.abs(currentX) > subdivisionPrecision &&
    ++i < subdivisionMaxIterations
  );
  return currentT;
}

export function cubicBezier(
  mX1: number,
  mY1: number,
  mX2: number,
  mY2: number,
): Easing {
  if (mX1 === mY1 && mX2 === mY2) return noop;
  const getTForX = (aX: number) => binarySubdivide(aX, 0, 1, mX1, mX2);
  return (t) => (t === 0 || t === 1 ? t : calcBezier(getTForX(t), mY1, mY2));
}

// ---- modifiers ------------------------------------------------------------

/** Reverses an easing — turns easeIn into easeOut. */
export const reverseEasing = (easing: Easing): Easing => (p) =>
  1 - easing(1 - p);

/** Mirrors an easing across the midpoint — turns easeIn into easeInOut. */
export const mirrorEasing = (easing: Easing): Easing => (p) =>
  p <= 0.5 ? easing(2 * p) / 2 : (2 - easing(2 * (1 - p))) / 2;

// ---- named easings --------------------------------------------------------

export const linear: Easing = noop;

export const easeIn: Easing = cubicBezier(0.42, 0, 1, 1);
export const easeOut: Easing = cubicBezier(0, 0, 0.58, 1);
export const easeInOut: Easing = cubicBezier(0.42, 0, 0.58, 1);

export const circIn: Easing = (p) => 1 - Math.sin(Math.acos(p));
export const circOut: Easing = reverseEasing(circIn);
export const circInOut: Easing = mirrorEasing(circIn);

export const backOut: Easing = cubicBezier(0.33, 1.53, 0.69, 0.99);
export const backIn: Easing = reverseEasing(backOut);
export const backInOut: Easing = mirrorEasing(backIn);

export const anticipate: Easing = (p) =>
  (p *= 2) < 1 ? 0.5 * backIn(p) : 0.5 * (2 - Math.pow(2, -10 * (p - 1)));
