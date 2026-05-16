// Animation orchestration ('main thread' worklets that operate on SharedValue)
export { animate } from './animate.js';
export type {
  AnimateOptions,
  AnimateControls,
  SpringOptions,
  TimingOptions,
} from './animate.js';

// Convenience wrappers
export { withSpring } from './with-spring.js';
export { withTiming } from './with-timing.js';

// Spring solver — pure-math API for non-worklet callers (tests, BG-side
// debugging, future scroll-driven derived values). NOT used by the worklet
// path: `animate()` has its own inlined copy of the solver to avoid
// cross-file `_c` capture of plain function references that don't survive
// JSON serialization across the MT/BG bridge.
export { spring, clamp } from './spring.js';
export type {
  SpringSolver,
  SpringStep,
  SpringSolverOptions,
} from './spring.js';

// Easings — same story as spring: pure-math API for non-worklet uses; the
// `animate()` worklet has its own inlined `easeOut`. Custom easings passed
// via `animate(sv, target, { ease: customFn })` will not survive worklet
// capture and is documented as out-of-scope for v0.1.
export {
  cubicBezier,
  reverseEasing,
  mirrorEasing,
  linear,
  easeIn,
  easeOut,
  easeInOut,
  circIn,
  circOut,
  circInOut,
  backIn,
  backOut,
  backInOut,
  anticipate,
} from './easings.js';
export type { Easing } from './easings.js';
