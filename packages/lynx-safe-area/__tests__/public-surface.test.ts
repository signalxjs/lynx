/**
 * Public-surface freeze test for @sigx/lynx-safe-area.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`EdgeInsets`, `Edge`, `SafeAreaMode`, `SafeAreaContextValue`,
 *    `RawSafeAreaProps`, `SharedValue`, the two component prop types) are
 *    erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures. This package exposes no
 *    `isAvailable` (C2 does not apply — it is a globals reader, not a native
 *    capability module), so the weight sits on the C8 thread-suffix contract:
 *    `useSafeAreaInsetsMT` must stay a synchronous plain-value read and
 *    `useSafeAreaInsets` must stay a signal.
 *
 * Note: this package has no `.web.ts` sibling, so there is no web-parity
 * block (D7.1b) to assert.
 */
import type { Computed, PrimitiveSignal } from '@sigx/reactivity';
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as safeArea from '../src/index';
import type { EdgeInsets, SafeAreaContextValue } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(safeArea).sort()).toEqual(
            [
                // Provider + the native event name it listens on
                'SafeAreaProvider',
                'SAFE_AREA_EVENT',
                // Layout component
                'SafeAreaView',
                // Reads
                'useSafeAreaInsets',
                'useSafeAreaSharedValues',
                'useSafeAreaFrame',
                'useSafeAreaInsetsMT',
                // DI handle
                'useSafeAreaContext',
                // Global-props bridge, shared with the native publishers
                'readGlobalSafeArea',
                'GLOBAL_PROPS_KEY',
                // Zero-fallback constant consumers compare against
                'ZERO_INSETS',
            ].sort(),
        );
    });

    it('keeps the global-props key stable', () => {
        // iOS/Android publishers write under this literal string; renaming it
        // on the JS side alone silently yields ZERO_INSETS forever.
        expect(safeArea.GLOBAL_PROPS_KEY).toBe('safeArea');
        expect(safeArea.SAFE_AREA_EVENT).toBe('safeAreaChanged');
    });
});

describe('public types', () => {
    it('keeps the MT read synchronous and the BG read reactive (C8)', () => {
        // The `MT` suffix is the promise that the value is readable inside a
        // `'main thread'` worklet body — a plain value, never a signal and
        // never a Promise. Its non-MT sibling is the opposite: a signal whose
        // `.value` is what re-renders BG components.
        expectTypeOf(safeArea.useSafeAreaInsetsMT).toEqualTypeOf<() => EdgeInsets>();
        expectTypeOf(safeArea.useSafeAreaInsets).toEqualTypeOf<
            () => PrimitiveSignal<EdgeInsets> | Computed<EdgeInsets>
        >();
        expectTypeOf(safeArea.useSafeAreaInsets().value).toEqualTypeOf<EdgeInsets>();
    });

    it('pins the inset record shape', () => {
        // Consumers destructure these by name and the native publishers fill
        // them by name; dropping or renaming an edge is a breaking change on
        // both sides at once.
        expectTypeOf<EdgeInsets>().toEqualTypeOf<{
            top: number;
            right: number;
            bottom: number;
            left: number;
            keyboard: number;
            statusBar: number;
            navigationBar: number;
        }>();
        expectTypeOf(safeArea.ZERO_INSETS).toEqualTypeOf<EdgeInsets>();
    });

    it('keeps readGlobalSafeArea total — zero, never null', () => {
        // Deliberately unlike `@sigx/lynx-appearance`'s nullable reader: the
        // cold-start state here collapses to ZERO_INSETS, so callers need no
        // null branch. Making it nullable would break every call site.
        expectTypeOf(safeArea.readGlobalSafeArea).toEqualTypeOf<() => EdgeInsets>();
    });

    it('keeps the SharedValue accessor nullable outside a provider', () => {
        // `null` is how a consumer learns there is no <SafeAreaProvider> in
        // scope; a non-null type would push that failure into a worklet.
        expectTypeOf(safeArea.useSafeAreaSharedValues).toEqualTypeOf<
            () => SafeAreaContextValue['sv'] | null
        >();
    });

    it('pins the frame computation as a computed rect', () => {
        // The viewport args are the caller's responsibility (this package has
        // no device-metrics dependency); dropping them would be a silent
        // behaviour change, not a compile error, for positional callers.
        expectTypeOf(safeArea.useSafeAreaFrame).toEqualTypeOf<
            (
                viewportWidth: number,
                viewportHeight: number,
            ) => Computed<{ x: number; y: number; width: number; height: number }>
        >();
    });
});
