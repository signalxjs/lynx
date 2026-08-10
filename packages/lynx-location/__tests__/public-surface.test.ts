/**
 * Public-surface freeze test for @sigx/lynx-location.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`LocationResult`, `LocationOptions`, the re-exported
 *    `PermissionResponse`) are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — permission methods resolve a
 *    `PermissionResponse` (C6) and `isAvailable` stays synchronous (C2).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as location from '../src/index';
import { Location } from '../src/index';
import type { LocationOptions, LocationResult, PermissionResponse } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(location).sort()).toEqual(['Location']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Location).sort()).toEqual([
            'getCurrentPosition',
            'getPermissionStatus',
            'isAvailable',
            'requestPermission',
        ]);
    });
});

describe('public types', () => {
    it('pins the position read and keeps its options optional', () => {
        // `options` defaulting to `{}` is part of the surface: consumers call
        // `getCurrentPosition()` bare, so making the argument required would
        // be a breaking change a runtime snapshot alone would not see.
        expectTypeOf(Location.getCurrentPosition).toEqualTypeOf<
            (options?: LocationOptions) => Promise<LocationResult>
        >();
        // The fix shape is what callers destructure; nullable fields stay
        // nullable, since a device without altitude/heading reports `null`
        // rather than 0 and collapsing them would read as "at sea level".
        expectTypeOf<LocationResult>().toEqualTypeOf<{
            latitude: number;
            longitude: number;
            altitude: number | null;
            accuracy: number;
            speed: number | null;
            heading: number | null;
            timestamp: number;
        }>();
    });

    it('keeps both permission methods on the PermissionResponse envelope (C6)', () => {
        // Both must resolve the same envelope: consumers branch on `status`
        // and use `canAskAgain` to decide between re-prompting and deep-linking
        // to Settings. A method narrowed to a bare status string would silently
        // make `canAskAgain` `undefined`, i.e. falsy, i.e. "never re-prompt".
        expectTypeOf(Location.requestPermission).toEqualTypeOf<() => Promise<PermissionResponse>>();
        expectTypeOf(Location.getPermissionStatus).toEqualTypeOf<
            () => Promise<PermissionResponse>
        >();
        expectTypeOf<PermissionResponse>().toEqualTypeOf<{
            status: 'granted' | 'denied' | 'undetermined' | 'blocked';
            canAskAgain: boolean;
        }>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Location.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Location.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps location.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/location.web');
        expect(Object.keys(web.Location).sort()).toEqual(Object.keys(Location).sort());
    });
});
