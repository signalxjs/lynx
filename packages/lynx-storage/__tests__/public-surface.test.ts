/**
 * Public-surface freeze test for @sigx/lynx-storage.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    barrel re-exports only the `Storage` namespace (C1), so the method set
 *    is snapshotted separately.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2), and the sync-void writes vs. Promise reads split is the shape both
 *    implementations have to keep.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as storage from '../src/index';
import { Storage } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(storage).sort()).toEqual(['Storage']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Storage).sort()).toEqual(
            ['setItem', 'getItem', 'removeItem', 'clear', 'getAllKeys', 'isAvailable'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the write methods as synchronous void', () => {
        // Fire-and-forget writes are the contract callers build on: the web
        // shim goes to lengths (write-through mirror over an ordered IDB
        // chain) to keep them sync-void. Turning one into a Promise would
        // silently strand every existing un-awaited call site.
        expectTypeOf(Storage.setItem).toEqualTypeOf<(key: string, value: string) => void>();
        expectTypeOf(Storage.removeItem).toEqualTypeOf<(key: string) => void>();
        expectTypeOf(Storage.clear).toEqualTypeOf<() => void>();
    });

    it('pins the read methods and their nullability', () => {
        // `null` is "no such key", distinct from the empty string; collapsing
        // it would make absence indistinguishable from a stored ''.
        expectTypeOf(Storage.getItem).toEqualTypeOf<(key: string) => Promise<string | null>>();
        expectTypeOf(Storage.getAllKeys).toEqualTypeOf<() => Promise<string[]>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Storage.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Storage.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps storage.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/storage.web');
        expect(Object.keys(web.Storage).sort()).toEqual(Object.keys(Storage).sort());
    });
});
