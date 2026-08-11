/**
 * Public-surface freeze test for @sigx/lynx-file-system.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect (`FileInfo`
 *    is type-only, so it never shows up here).
 *  - Types: the method signatures are pinned, because the shapes are what
 *    `CONVENTIONS.md` constrains — the sync/async split in particular, which a
 *    typecheck of the package alone would happily let drift.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as fileSystem from '../src/index';
import { FileSystem, type FileInfo } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(fileSystem).sort()).toEqual(['FileSystem']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(FileSystem).sort()).toEqual(
            [
                'readFile',
                'readFileBase64',
                'readFileAsArrayBuffer',
                'writeFile',
                'deleteFile',
                'getInfo',
                'getDocumentDirectory',
                'getCacheDirectory',
                'isAvailable',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the async file operations', () => {
        expectTypeOf(FileSystem.readFile).toEqualTypeOf<(path: string) => Promise<string>>();
        expectTypeOf(FileSystem.readFileBase64).toEqualTypeOf<(path: string) => Promise<string>>();
        expectTypeOf(FileSystem.readFileAsArrayBuffer).toEqualTypeOf<
            (path: string) => Promise<ArrayBuffer>
        >();
        expectTypeOf(FileSystem.writeFile).toEqualTypeOf<
            (path: string, content: string) => Promise<void>
        >();
        // `Promise<void>` on both mutators is the C4 contract in the type
        // system: failures leave through a rejection, so there is no result
        // object for a caller to inspect (or forget to inspect).
        expectTypeOf(FileSystem.deleteFile).toEqualTypeOf<(path: string) => Promise<void>>();
        expectTypeOf(FileSystem.getInfo).toEqualTypeOf<(path: string) => Promise<FileInfo>>();
    });

    it('keeps the directory getters synchronous', () => {
        // Consumers build paths inline (`getDocumentDirectory() + '/x.json'`);
        // turning either into a Promise would silently produce
        // "[object Promise]/x.json" rather than a type error at the call site.
        expectTypeOf(FileSystem.getDocumentDirectory).toEqualTypeOf<() => string>();
        expectTypeOf(FileSystem.getCacheDirectory).toEqualTypeOf<() => string>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention this package already gets right, and the one most
        // worth freezing: `Biometric.isAvailable()` drifted into returning a
        // Promise, which makes `if (mod.isAvailable())` silently always true.
        expectTypeOf(FileSystem.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(FileSystem.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the FileInfo record', () => {
        // Returned straight from native; a dropped or renamed field is a
        // consumer-visible break that no other test in the package covers.
        expectTypeOf<FileInfo>().toEqualTypeOf<{
            uri: string;
            size: number;
            exists: boolean;
            isDirectory: boolean;
            modifiedAt: number;
        }>();
    });
});
