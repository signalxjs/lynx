/**
 * Public-surface freeze test for @sigx/lynx-secure-storage.
 *
 * Locks the exported API so accidental removals or renames break CI rather
 * than reaching consumers. Update the snapshot and the type pins together when
 * the surface changes on purpose.
 *
 * Worth freezing carefully here: this package just renamed `set`/`get`/`delete`
 * to `setItem`/`getItem`/`removeItem` so it stops contradicting
 * `@sigx/lynx-storage` about the same operation (#903/#907). A freeze test is
 * how that agreement stays true — the two packages drifted apart precisely
 * because nothing checked.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as secureStorage from '../src/index';
import { SecureStorage } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(secureStorage).sort()).toEqual(['SecureStorage']);
    });

    it('exposes exactly the documented methods', () => {
        expect(Object.keys(SecureStorage).sort()).toEqual([
            'clear',
            'getItem',
            'hasKey',
            'isAvailable',
            'removeItem',
            'setItem',
        ]);
    });

    it('names its CRUD the same as @sigx/lynx-storage', () => {
        // The reason this package renamed. `Storage` and `SecureStorage` are
        // the same concept with different durability, and callers swap between
        // them; two names for one operation is the incoherence epic #857 exists
        // to remove.
        for (const method of ['setItem', 'getItem', 'removeItem', 'clear']) {
            expect(SecureStorage, method).toHaveProperty(method);
        }
        // And the old names are gone, not aliased — a compat shim would keep
        // both spellings alive, which is the thing being fixed.
        for (const gone of ['set', 'get', 'delete']) {
            expect(SecureStorage, gone).not.toHaveProperty(gone);
        }
    });
});

describe('public types', () => {
    it('pins the CRUD signatures', () => {
        expectTypeOf(SecureStorage.setItem).toEqualTypeOf<
            (key: string, value: string, opts?: secureStorage.SecureStorageSetOptions) => Promise<void>
        >();
        expectTypeOf(SecureStorage.getItem).toEqualTypeOf<
            (key: string, opts?: secureStorage.SecureStorageGetOptions) => Promise<string | null>
        >();
        expectTypeOf(SecureStorage.removeItem).toEqualTypeOf<(key: string) => Promise<void>>();
    });

    it('keeps a missing key as null rather than a throw', () => {
        // Callers branch on this; a throw would make "not stored yet" an error
        // path, which it isn't.
        expectTypeOf(SecureStorage.getItem).returns.toEqualTypeOf<Promise<string | null>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        expectTypeOf(SecureStorage.isAvailable).toEqualTypeOf<() => boolean>();
    });
});
