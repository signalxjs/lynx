/**
 * Public-surface freeze test for @sigx/lynx-haptics.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    type-only exports (`ImpactStyle`, `NotificationType`,
 *    `HapticsDiagnostics`) are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous (C2),
 *    and the three feedback methods have to stay `void` (a Promise return
 *    would invite `await` in a hot event handler, and would mean the "never
 *    throw" contract had become "rejects unhandled").
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as haptics from '../src/index';
import { Haptics } from '../src/index';
import type { HapticsDiagnostics, ImpactStyle, NotificationType } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(haptics).sort()).toEqual(['Haptics']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Haptics).sort()).toEqual(
            ['impact', 'notification', 'selection', 'isAvailable', 'diagnose'].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps the feedback methods fire-and-forget', () => {
        // `void`, not `Promise<void>`: these are called as the first statement
        // of an event handler and must not become awaitable/rejectable. The
        // default arguments are part of the surface too — `Haptics.impact()`
        // with no argument is the documented common case.
        expectTypeOf(Haptics.impact).toEqualTypeOf<(style?: ImpactStyle) => void>();
        expectTypeOf(Haptics.notification).toEqualTypeOf<(type?: NotificationType) => void>();
        expectTypeOf(Haptics.selection).toEqualTypeOf<() => void>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Haptics.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Haptics.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the diagnostics envelope', () => {
        // Only `hasVibrator` is guaranteed; the rest are Android-only, so they
        // must stay optional or every consumer's non-null read starts lying on
        // iOS.
        expectTypeOf(Haptics.diagnose).toEqualTypeOf<() => Promise<HapticsDiagnostics>>();
        expectTypeOf<HapticsDiagnostics>().toEqualTypeOf<{
            hasVibrator: boolean;
            sdk?: number;
            hasVibratePermission?: boolean;
            hasAmplitudeControl?: boolean;
        }>();
    });

    it('pins the feedback enums', () => {
        // These are string-literal unions on purpose: widening either to
        // `string` removes the compile-time typo check consumers rely on.
        expectTypeOf<ImpactStyle>().toEqualTypeOf<'light' | 'medium' | 'heavy'>();
        expectTypeOf<NotificationType>().toEqualTypeOf<'success' | 'warning' | 'error'>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps haptics.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/haptics.web');
        expect(Object.keys(web.Haptics).sort()).toEqual(Object.keys(Haptics).sort());
    });
});
