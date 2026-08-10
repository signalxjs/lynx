/**
 * Public-surface freeze test for @sigx/lynx-permissions.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`, with
 * one difference worth stating plainly: this package deliberately has **no JS
 * surface at all**. It ships only Android Kotlin (`PermissionHelper.kt`,
 * `MediaCapture.kt`) and exists so the auto-linker pulls one copy of the
 * permission plumbing in behind the modules that depend on it; the JS barrel
 * is `export {}`. So the freeze here runs the other way round — it asserts the
 * surface is still empty, which fails the moment someone bolts a JS API onto
 * the barrel. That is the accident worth catching: a cross-platform
 * `permissions.request('camera')` is a real, wanted API (the barrel's docblock
 * says as much), but it has to arrive through the module conventions —
 * `isAvailable` synchronous (C2), `Promise<PermissionResponse>` results (C6) —
 * and with README and docs to match, not as an unreviewed extra key.
 *
 * There are therefore no `expectTypeOf` pins: with zero value exports and no
 * exported types, there is no shape to pin. Add them together with the API.
 *
 * Note: this package has no `.web.ts` sibling — it is Android-only — so there
 * is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, it } from 'vitest';

import * as permissions from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface (intentionally empty)', () => {
        expect(Object.keys(permissions).sort()).toEqual([]);
    });
});
