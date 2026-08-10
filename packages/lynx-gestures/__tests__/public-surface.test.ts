/**
 * Public-surface freeze test for @sigx/lynx-gestures.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`PressableProps`, `SwipeSide`, `ScrollContext`, …) are erased at
 *    runtime and are pinned below instead.
 *  - Types: the load-bearing shapes. This package holds no native module, so
 *    there is no `isAvailable` (C2), no permission envelope (C6) and no
 *    `subscribe` disposer (C7) to freeze. What breaks consumers here instead
 *    is the thread contract (C8): the indicator hooks hand back a
 *    `MainThreadRef` that only does anything once spread onto an element, and
 *    the injected `ScrollContext` is the handshake every custom gesture
 *    component uses to yield to a parent `<ScrollView>`.
 *
 * Note: this package has no `.web.ts` sibling (`src/web/element.ts` is a
 * host-page custom-element registration, not a swapped implementation), so
 * there is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as gestures from '../src/index';
import {
    TOUCH_GUARD_TAG,
    useScrollContext,
    useSwiperDotProgress,
    useSwiperDotTranslate,
} from '../src/index';
import type { ScrollContext } from '../src/index';
import type { MainThread, MainThreadRef } from '@sigx/lynx';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(gestures).sort()).toEqual(
            [
                // Native elements (require `sigx prebuild`)
                'PinchRotate',
                'TouchGuard',
                'TOUCH_GUARD_TAG',
                // Arena-driven MT components
                'Draggable',
                'Pressable',
                'ScrollView',
                'Swipeable',
                'Swiper',
                // Swiper indicator hooks
                'useSwiperDotGrowX',
                'useSwiperDotProgress',
                'useSwiperDotScale',
                'useSwiperDotTranslate',
                'useSwiperDotWidth',
                // ScrollView ↔ child-gesture coordination
                'useScrollContext',
                // Cross-thread primitives re-exported from @sigx/lynx for
                // back-compat (deprecated since 0.3.0 — they moved out in
                // Phase 2.6). Frozen because removing them is a breaking
                // change consumers have to be told about, not a cleanup.
                'AnimatedValue',
                'SharedValue',
                'resetAnimatedStyleBindingIds',
                'useAnimatedStyle',
                'useAnimatedValue',
                'useSharedValue',
            ].sort(),
        );
    });

    it('keeps the deprecated primitives identical to their @sigx/lynx originals', () => {
        // Aliases, not copies: consumer code mixes imports from both packages
        // and does `instanceof SharedValue`, so a re-implementation here would
        // silently fail those checks.
        expect(gestures.AnimatedValue).toBe(gestures.SharedValue);
        expect(gestures.useAnimatedValue).toBe(gestures.useSharedValue);
    });
});

describe('public types', () => {
    it('pins the indicator hooks as returning a main-thread ref (C8)', () => {
        // The whole point of these hooks is that the returned ref is spread
        // onto an element and driven on the main thread — returning a signal
        // or a plain value instead would compile at the call site and then do
        // nothing at runtime.
        expectTypeOf(useSwiperDotProgress).returns.toEqualTypeOf<
            MainThreadRef<MainThread.Element | null>
        >();
        expectTypeOf(useSwiperDotTranslate).returns.toEqualTypeOf<
            MainThreadRef<MainThread.Element | null>
        >();
        expectTypeOf(gestures.useSwiperDotScale).returns.toEqualTypeOf<
            MainThreadRef<MainThread.Element | null>
        >();
    });

    it('keeps useScrollContext nullable (no parent ScrollView is legal)', () => {
        // Descendants branch on presence; collapsing the `null` would make
        // `<Draggable>` outside a `<ScrollView>` a type error instead of the
        // supported case it is.
        expectTypeOf(useScrollContext).returns.toEqualTypeOf<ScrollContext | null>();
    });

    it('pins the ScrollContext members descendants drive', () => {
        // Gesture children write `dragging` and read the offsets from
        // worklets; a rename here breaks every custom gesture component that
        // opted into the auto-yield behaviour.
        expectTypeOf<ScrollContext['dragging']['value']>().toEqualTypeOf<boolean>();
        expectTypeOf<ScrollContext['offsetX']['value']>().toEqualTypeOf<number>();
        expectTypeOf<ScrollContext['scrollOrientation']>().toEqualTypeOf<
            'vertical' | 'horizontal'
        >();
    });

    it('freezes TOUCH_GUARD_TAG as the string it is', () => {
        // Frozen as-is, not endorsed: the declaration widens to `string`
        // rather than the `'sigx-touch-guard'` literal, so consumers passing
        // it to `@sigx/lynx-sheet`'s `guardTag` get no compile-time check
        // that the tag matches a registered intrinsic. Narrowing it is a
        // deliberate surface change — update this line with it.
        expectTypeOf(TOUCH_GUARD_TAG).toEqualTypeOf<string>();
        expect(TOUCH_GUARD_TAG).toBe('sigx-touch-guard');
    });
});
