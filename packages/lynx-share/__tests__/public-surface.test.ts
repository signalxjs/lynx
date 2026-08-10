/**
 * Public-surface freeze test for @sigx/lynx-share.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    type-only `ShareOptions` is erased at runtime and is pinned below
 *    instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2), and `share()` is deliberately sync-void on both platforms.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as share from '../src/index';
import { Share } from '../src/index';
import type { ShareOptions } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(share).sort()).toEqual(['Share']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Share).sort()).toEqual(['isAvailable', 'share'].sort());
    });
});

describe('public types', () => {
    it('keeps share() sync-void with an all-optional options bag', () => {
        // `share()` returns nothing on purpose: the native dialog's outcome
        // isn't reported back, so a Promise here would be a lie callers would
        // start awaiting. Every field being optional is equally load-bearing —
        // callers pass `{ url }` alone.
        expectTypeOf(Share.share).toEqualTypeOf<(options: ShareOptions) => void>();
        expectTypeOf<ShareOptions>().toEqualTypeOf<{
            title?: string;
            message?: string;
            url?: string;
        }>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Share.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Share.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps share.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/share.web');
        expect(Object.keys(web.Share).sort()).toEqual(Object.keys(Share).sort());
    });
});
