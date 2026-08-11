/**
 * Public-surface freeze test for @sigx/lynx-image-picker.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    type-only exports (`ImagePickerOptions`, `ImagePickerResult`,
 *    `ImagePickerAsset`, the re-exported `PermissionResponse`) are erased at
 *    runtime and are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2), the permission methods have to keep resolving `PermissionResponse`
 *    (C6), and the picker result has to keep carrying `cancelled` (C5).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as imagePicker from '../src/index';
import { ImagePicker } from '../src/index';
import type { ImagePickerAsset, ImagePickerOptions, ImagePickerResult, PermissionResponse } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(imagePicker).sort()).toEqual(['ImagePicker']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(ImagePicker).sort()).toEqual(
            ['pickImage', 'pickVideo', 'requestPermission', 'getPermissionStatus', 'isAvailable'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the picker signatures', () => {
        // `options` stays optional on both: `pickImage()` with no argument is
        // the documented common case, so making the parameter required would
        // break every call site while still typechecking inside the package.
        expectTypeOf(ImagePicker.pickImage).toEqualTypeOf<
            (options?: ImagePickerOptions) => Promise<ImagePickerResult>
        >();
        expectTypeOf(ImagePicker.pickVideo).toEqualTypeOf<
            (options?: ImagePickerOptions) => Promise<ImagePickerResult>
        >();
    });

    it('keeps the result carrying `cancelled` with an always-present assets array (C5)', () => {
        // Callers branch on `cancelled` and then `.map(assets)` without a
        // null-check — the native layer normalizes the `canceled`/`cancelled`
        // spelling split and defaults `assets` to `[]` precisely so this
        // shape holds. Making `assets` optional would break that silently.
        // `cancelled` stays the *user's* answer only — a native failure
        // rejects instead (C4/C5); `image-picker.test.ts` pins that split,
        // which no type can express.
        expectTypeOf<ImagePickerResult>().toEqualTypeOf<{
            cancelled: boolean;
            assets: ImagePickerAsset[];
        }>();
        expectTypeOf<ImagePickerAsset>().toHaveProperty('uri').toEqualTypeOf<string>();
        expectTypeOf<ImagePickerAsset>().toHaveProperty('type').toEqualTypeOf<'image' | 'video'>();
    });

    it('keeps the permission methods on the C6 envelope', () => {
        expectTypeOf(ImagePicker.requestPermission).toEqualTypeOf<() => Promise<PermissionResponse>>();
        expectTypeOf(ImagePicker.getPermissionStatus).toEqualTypeOf<() => Promise<PermissionResponse>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(ImagePicker.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(ImagePicker.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps image-picker.web.js in by extensionAlias (#697), so
        // a method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/image-picker.web');
        expect(Object.keys(web.ImagePicker).sort()).toEqual(Object.keys(ImagePicker).sort());
    });
});
