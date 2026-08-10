/**
 * Public-surface freeze test for @sigx/lynx-appearance.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`ColorScheme`, `SetterResult`, `AppearanceProviderProps`, …)
 *    are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2), and the `MT` suffix has to keep meaning "synchronous main-thread
 *    read" (C8).
 *
 * Note: this package has no `.web.ts` sibling, so there is no web-parity
 * block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as appearance from '../src/index';
import type { ColorScheme, SetterResult, SystemBarStyle, SystemBarsStyleInput } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(appearance).sort()).toEqual(
            [
                // Provider + DI
                'AppearanceProvider',
                'APPEARANCE_EVENT',
                'useAppearanceContext',
                // Color-scheme reads
                'useSystemColorScheme',
                'useSystemColorSchemeMT',
                'readGlobalColorScheme',
                'GLOBAL_PROPS_KEY',
                // OS font scale — owned by @sigx/lynx-core, re-exported here
                // because text size is an appearance concern (see
                // font-scale.test.tsx for the re-export identity check).
                'useFontScale',
                'useFontScaleMT',
                'readGlobalFontScale',
                'FONT_SCALE_EVENT',
                'FONT_SCALE_GLOBAL_KEY',
                // Native setters
                'setStatusBarStyle',
                'setStatusBarBackgroundColor',
                'setNavigationBarStyle',
                'setSystemBarsStyle',
                'isAvailable',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true. This package is a bare root export rather
        // than a namespace method, but the signature contract is the same.
        expectTypeOf(appearance.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(appearance.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the setter signatures and their result envelope', () => {
        // Every setter resolves an envelope and never rejects, so callers can
        // `void setStatusBarStyle(...)`; a setter that started throwing or
        // returning `void` would break that contract invisibly.
        expectTypeOf(appearance.setStatusBarStyle).toEqualTypeOf<
            (style: SystemBarStyle) => Promise<SetterResult>
        >();
        expectTypeOf(appearance.setStatusBarBackgroundColor).toEqualTypeOf<
            (color: string | null) => Promise<SetterResult>
        >();
        expectTypeOf(appearance.setNavigationBarStyle).toEqualTypeOf<
            (opts: { style: SystemBarStyle; color?: string }) => Promise<SetterResult>
        >();
        expectTypeOf(appearance.setSystemBarsStyle).toEqualTypeOf<
            (opts: SystemBarsStyleInput) => Promise<SetterResult>
        >();
        expectTypeOf<SetterResult>().toEqualTypeOf<{ ok: boolean; reason?: string }>();
    });

    it('keeps the MT read synchronous and the BG read reactive (C8)', () => {
        // The `MT` suffix is the promise that the value is readable inside a
        // `'main thread'` worklet body — i.e. a plain value, never a signal
        // and never a Promise. Its non-MT sibling is the opposite: a signal
        // whose `.value` is what re-renders BG components.
        expectTypeOf(appearance.useSystemColorSchemeMT).toEqualTypeOf<() => ColorScheme>();
        expectTypeOf(appearance.useSystemColorScheme()).toHaveProperty('value');
        // Frozen as-is, not endorsed: the declared return is a
        // `PrimitiveSignal<ColorScheme> | Computed<ColorScheme>` union whose
        // `.value` widens to `string`, so consumers lose the `'light' |
        // 'dark'` narrowing (an exhaustive switch won't be checked). Tightening
        // it is a deliberate surface change — update this line with it.
        expectTypeOf(appearance.useSystemColorScheme().value).toEqualTypeOf<string>();
    });

    it('pins the global-props reader as nullable (unknown ≠ light)', () => {
        // `null` means "the publisher hasn't populated yet"; collapsing it to
        // `'light'` here would hide cold-start flashes from consumers.
        expectTypeOf(appearance.readGlobalColorScheme).toEqualTypeOf<() => ColorScheme | null>();
        expectTypeOf<ColorScheme>().toEqualTypeOf<'light' | 'dark'>();
    });
});
