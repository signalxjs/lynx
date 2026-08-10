/**
 * Public-surface freeze test for @sigx/lynx-file-picker.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect (the
 *    option/result interfaces are type-only and never appear here).
 *  - Types: the method signatures are pinned, because the shapes are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous (C2)
 *    and the pick result has to keep its `cancelled` discriminant (C5), which
 *    every consumer branches on before touching `assets`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as filePicker from '../src/index';
import { FilePicker } from '../src/index';
import type { FilePickerAsset, FilePickerOptions, FilePickerResult } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(filePicker).sort()).toEqual(['FilePicker']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(FilePicker).sort()).toEqual(['isAvailable', 'pick']);
    });
});

describe('public types', () => {
    it('pins the method signatures', () => {
        expectTypeOf(FilePicker.pick).toEqualTypeOf<
            (options?: FilePickerOptions) => Promise<FilePickerResult>
        >();
        // `options` staying optional is load-bearing: `FilePicker.pick()` with
        // no argument is the documented default-everything call.
        expectTypeOf<Parameters<typeof FilePicker.pick>>().toEqualTypeOf<[options?: FilePickerOptions]>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention this package already gets right, and the one most
        // worth freezing: `Biometric.isAvailable()` drifted into returning a
        // Promise, which makes `if (mod.isAvailable())` silently always true.
        expectTypeOf(FilePicker.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(FilePicker.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('keeps the cancelled/assets result contract (C5)', () => {
        // Consumers gate on `cancelled` before reading `assets`; dropping the
        // flag, or making `assets` optional, breaks every call site silently.
        expectTypeOf<FilePickerResult>().toEqualTypeOf<{
            cancelled: boolean;
            assets: FilePickerAsset[];
        }>();
    });

    it('keeps every asset field required', () => {
        // `@sigx/lynx-http`'s FormData consumes picked assets as file handles
        // and reads all four fields; making any of them optional breaks uploads.
        expectTypeOf<FilePickerAsset>().toEqualTypeOf<{
            uri: string;
            name: string;
            mimeType: string;
            size: number;
        }>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps file-picker.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/file-picker.web');
        expect(Object.keys(web.FilePicker).sort()).toEqual(Object.keys(FilePicker).sort());
    });
});
