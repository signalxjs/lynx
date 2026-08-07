/**
 * Public-surface freeze test for @sigx/lynx-clipboard.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect.
 *  - Types: the method signatures are pinned, because the shapes are what
 *    `CONVENTIONS.md` constrains — `isAvailable` in particular has to stay
 *    synchronous (C2).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as clipboard from '../src/index';
import { Clipboard } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(clipboard).sort()).toEqual(['Clipboard']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Clipboard).sort()).toEqual([
            'getString',
            'hasString',
            'isAvailable',
            'setString',
        ]);
    });
});

describe('public types', () => {
    it('pins the method signatures', () => {
        expectTypeOf(Clipboard.setString).toEqualTypeOf<(text: string) => Promise<void>>();
        expectTypeOf(Clipboard.getString).toEqualTypeOf<() => Promise<string>>();
        expectTypeOf(Clipboard.hasString).toEqualTypeOf<() => Promise<boolean>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention this package already gets right, and the one most
        // worth freezing: `Biometric.isAvailable()` drifted into returning a
        // Promise, which makes `if (mod.isAvailable())` silently always true.
        expectTypeOf(Clipboard.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Clipboard.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps clipboard.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/clipboard.web');
        expect(Object.keys(web.Clipboard).sort()).toEqual(Object.keys(Clipboard).sort());
    });
});
