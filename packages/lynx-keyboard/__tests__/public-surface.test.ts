/**
 * Public-surface freeze test for @sigx/lynx-keyboard.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`KeyboardState`, `KeyboardAvoidingBehavior`, the two props
 *    types) are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing hook signatures, because the reactive wrapper a
 *    hook returns is what a consumer builds against — `CONVENTIONS.md` C8
 *    makes the `SV` suffix a promise about which thread the value lives on,
 *    and swapping a `Computed` for a plain number (or vice versa) breaks
 *    every call site silently at the `.value` read.
 *
 * This package exposes no `isAvailable()` (C2) and no permissions (C6) — it
 * is a pure layout/hook package over the safe-area bridge — so those pins do
 * not apply. It also has no `.web.ts` sibling, so there is no web-parity
 * block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as keyboard from '../src/index';
import type { Computed, SharedValue } from '@sigx/lynx';
import type { KeyboardAvoidingBehavior, KeyboardState } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(keyboard).sort()).toEqual(
            [
                // Layout primitives
                'KeyboardAvoidingView',
                'KeyboardStickyView',
                // RN-ecosystem aliases of the sticky view — part of the
                // published surface, so a rename of the underlying component
                // must not quietly drop them.
                'KeyboardAccessoryView',
                'KeyboardToolbar',
                // Hooks
                'useKeyboard',
                'useKeyboardLift',
                'useKeyboardLiftSV',
                // Remembered-lift module state (#811)
                'rememberedKeyboardLift',
                // Frozen as-is, not endorsed: `@internal` test seam that the
                // barrel publishes. See `surfaceConcerns` on the audit issue.
                'resetRememberedKeyboardLift',
            ].sort(),
        );
    });

    it('keeps the RN aliases pointing at the same component', () => {
        // They are aliases, not copies: a consumer mixing `KeyboardToolbar`
        // and `KeyboardStickyView` in one tree must get identical behavior,
        // and the runtime component identity is what guarantees that.
        expect(keyboard.KeyboardAccessoryView).toBe(keyboard.KeyboardStickyView);
        expect(keyboard.KeyboardToolbar).toBe(keyboard.KeyboardStickyView);
    });
});

describe('public types', () => {
    it('pins the BG-reactive hooks as signals, not snapshots (C8)', () => {
        // No `SV`/`MT` suffix ⇒ a BG signal whose `.value` re-renders the
        // component. Returning a plain value instead would typecheck at most
        // call sites (`.height` on the object) while freezing the layout at
        // its mount-time keyboard state.
        expectTypeOf(keyboard.useKeyboard).toEqualTypeOf<() => Computed<KeyboardState>>();
        expectTypeOf(keyboard.useKeyboardLift).toEqualTypeOf<
            (discountBottomInset?: boolean, offset?: number) => Computed<number>
        >();
    });

    it('keeps the SV hook on the main thread (C8)', () => {
        // The `SV` suffix is the promise that the lift is bindable from a
        // `'main thread'` worklet — `useAnimatedStyle(ref, sv, 'translateY')`
        // needs a SharedValue, and a Computed there animates nothing.
        expectTypeOf(keyboard.useKeyboardLiftSV).toEqualTypeOf<
            (
                discountBottomInset?: boolean,
                offset?: number,
                duration?: number,
            ) => SharedValue<number>
        >();
    });

    it('keeps the remembered lift a synchronous number', () => {
        // Panels sized to occupy the keyboard's space read this during
        // render to avoid the first-open jump (#811); making it async would
        // reintroduce exactly the frame it exists to remove.
        expectTypeOf(keyboard.rememberedKeyboardLift).toEqualTypeOf<() => number>();
    });

    it('pins the keyboard state shape and behavior union', () => {
        // `visible` is derived from `height > 0`, but consumers branch on it
        // directly; and the behavior union is a prop literal set, so widening
        // it to `string` would drop every autocomplete and typo check.
        expectTypeOf<KeyboardState>().toEqualTypeOf<{ height: number; visible: boolean }>();
        expectTypeOf<KeyboardAvoidingBehavior>().toEqualTypeOf<'padding' | 'translate' | 'height'>();
    });
});
