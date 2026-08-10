/**
 * Public-surface freeze test for @sigx/lynx-motion.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`AnimateOptions`, `SpringOptions`, `Easing`, …) are erased at
 *    runtime and are pinned below instead.
 *  - Types: the load-bearing signatures. This package has no native module,
 *    so the C2/C6/C7 conventions don't apply; what does carry weight is the
 *    worklet contract — `animate()` hands back a `{ stop, finished }` handle
 *    and the `with*` wrappers hand back the bare promise, and every animator
 *    takes a `SharedValue<number>` rather than a signal.
 *
 * Note: this package has no `.web.ts` sibling (the animators are pure math
 * plus `requestAnimationFrame`, identical on every target), so there is no
 * web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { SharedValue } from '@sigx/lynx';

import * as motion from '../src/index';
import type {
    AnimateControls,
    AnimateOptions,
    Easing,
    SpringOptions,
    SpringSolver,
    SpringSolverOptions,
    TimingOptions,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(motion).sort()).toEqual(
            [
                // Animators — 'main thread' worklets driving a SharedValue
                'animate',
                'cancelAnimation',
                'withSpring',
                'withTiming',
                // Pure-math spring solver, for non-worklet callers
                'spring',
                'clamp',
                // Easings — pure math, callable from BG or inside a worklet
                'cubicBezier',
                'reverseEasing',
                'mirrorEasing',
                'linear',
                'easeIn',
                'easeOut',
                'easeInOut',
                'circIn',
                'circOut',
                'circInOut',
                'backIn',
                'backOut',
                'backInOut',
                'anticipate',
            ].sort(),
        );
    });

    it('does not leak the in-flight test hook', () => {
        // `_resetInflight` exists in animate.ts for the tick tests; it clears
        // global cancellation state and would be a footgun in app code, so the
        // barrel must keep withholding it.
        expect(motion).not.toHaveProperty('_resetInflight');
    });
});

describe('public types', () => {
    it('pins the animator signatures', () => {
        // `options` is optional on all three (defaulted), and the target is a
        // `SharedValue<number>` — not a signal and not a ref. Widening either
        // would silently accept values the worklet body can't write through.
        expectTypeOf(motion.animate).toEqualTypeOf<
            (sv: SharedValue<number>, target: number, options?: AnimateOptions) => AnimateControls
        >();
        expectTypeOf(motion.withSpring).toEqualTypeOf<
            (sv: SharedValue<number>, target: number, options?: SpringOptions) => Promise<void>
        >();
        expectTypeOf(motion.withTiming).toEqualTypeOf<
            (sv: SharedValue<number>, target: number, options?: TimingOptions) => Promise<void>
        >();
        expectTypeOf(motion.cancelAnimation).toEqualTypeOf<(sv: SharedValue<number>) => void>();
    });

    it('keeps the controls handle imperative-plus-awaitable', () => {
        // Callers do both `controls.stop()` (gesture claiming a settle tween)
        // and `await controls.finished` (sequencing). Collapsing the handle to
        // a bare promise, or making `stop` async, breaks one of the two.
        expectTypeOf<AnimateControls>().toEqualTypeOf<{
            stop(): void;
            finished: Promise<void>;
        }>();
        expectTypeOf<AnimateOptions>().toMatchTypeOf<{ type?: 'spring' | 'tween' }>();
    });

    it('keeps the spring solver time-stateless (motion pattern)', () => {
        // `next(t)` takes the elapsed ms every tick — the solver holds no
        // clock. A solver that started owning time could not be driven from a
        // worklet whose frame source differs per platform.
        expectTypeOf(motion.spring).toEqualTypeOf<(options: SpringSolverOptions) => SpringSolver>();
        expectTypeOf<SpringSolver['next']>().toEqualTypeOf<
            (t: number) => { done: boolean; value: number }
        >();
        // Keyframes stay a fixed pair; a variable-length array would change
        // the integrator's meaning of "target".
        expectTypeOf<SpringSolverOptions['keyframes']>().toEqualTypeOf<[number, number]>();
    });

    it('keeps every named easing a plain unary number function', () => {
        // Easings are inlined into worklet bodies by callers, so they must
        // stay `(t: number) => number` with no closure over module state that
        // a `_c` capture would drop.
        expectTypeOf<Easing>().toEqualTypeOf<(t: number) => number>();
        expectTypeOf(motion.easeInOut).toEqualTypeOf<Easing>();
        expectTypeOf(motion.anticipate).toEqualTypeOf<Easing>();
        expectTypeOf(motion.cubicBezier).toEqualTypeOf<
            (mX1: number, mY1: number, mX2: number, mY2: number) => Easing
        >();
        expectTypeOf(motion.mirrorEasing).toEqualTypeOf<(easing: Easing) => Easing>();
        expectTypeOf(motion.reverseEasing).toEqualTypeOf<(easing: Easing) => Easing>();
    });

    it('pins clamp as (min, max, v) — argument order is load-bearing', () => {
        // Frozen as-is, not endorsed: `clamp` is a motion-utils helper the
        // barrel re-exports, and its value-last order is the opposite of the
        // common `clamp(v, min, max)`. Three `number`s means a swap typechecks
        // clean, so the freeze is the only guard.
        expectTypeOf(motion.clamp).toEqualTypeOf<(min: number, max: number, v: number) => number>();
    });
});
