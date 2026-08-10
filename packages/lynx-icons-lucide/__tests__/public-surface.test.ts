/**
 * Public-surface freeze test for @sigx/lynx-icons-lucide.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect — for the
 *    root barrel and for the published `./components` subpath, since
 *    `package.json#exports` makes each of them a separate promise to
 *    consumers.
 *  - Types: the load-bearing shapes are pinned. This is a build-time adapter
 *    package with no native module, so there is no `isAvailable`/permission
 *    surface (C2/C6) and no subscription or hook contract (C7/C8) to freeze;
 *    the whole weight goes on the `IconAdapter` contract that
 *    `@sigx/lynx-plugin`'s icons slice calls into.
 *
 * Note: this package has no `.web.ts` sibling — the adapter runs in the
 * bundler, never on a device — so there is no web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import adapter from '../src/index';
import * as lucideAdapter from '../src/index';
import type { GlyphData, IconAdapter } from '@sigx/lynx-icons';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        // The adapter contract is "default-export an IconAdapter from the main
        // entry" (see `IconAdapter`'s docblock), so the barrel deliberately
        // publishes nothing else — every helper in index.ts stays private.
        expect(Object.keys(lucideAdapter).sort()).toEqual(['default']);
    });

    it('exposes exactly the adapter methods the plugin calls', () => {
        // The plugin resolves glyphs, font paths and the `include: ['*']`
        // catalog through these four; losing one degrades to blank icons at
        // build time rather than failing loudly.
        expect(Object.keys(adapter).sort()).toEqual([
            'getFontPath',
            'getGlyph',
            'listGlyphs',
            'styles',
        ]);
    });

    it('keeps the /components subpath surface', async () => {
        // A separate `exports` subpath so the root entry stays importable in a
        // plain Node bundler process without pulling in @sigx/lynx's JSX
        // runtime; apps import `@sigx/lynx-icons-lucide/components` directly
        // and never touch the barrel.
        const components = await import('../src/components');
        expect(Object.keys(components).sort()).toEqual(['LucideIcon']);
    });
});

describe('public types', () => {
    it('pins the default export as an IconAdapter', () => {
        // The plugin type-checks against `IconAdapter`; widening or narrowing
        // the declared type here is the change that would break every other
        // adapter package's assumption of a shared contract.
        expectTypeOf(adapter).toEqualTypeOf<IconAdapter>();
    });

    it('pins the glyph resolver signatures', () => {
        // `null` is the "unknown glyph" channel — a resolver that started
        // throwing, or returned `GlyphData` non-nullably, would turn a typo in
        // a `name=` prop into a hard build failure instead of a skipped icon.
        expectTypeOf(adapter.getGlyph).toEqualTypeOf<
            (style: string, name: string) => GlyphData | null
        >();
        expectTypeOf(adapter.listGlyphs).toEqualTypeOf<(style: string) => string[]>();
        expectTypeOf(adapter.styles).toEqualTypeOf<string[]>();
    });

    it('keeps getFontPath nullable (lucide is SVG-only)', () => {
        // The `string | null` return is what forces SVG mode; making it
        // `string` would have the plugin hand a bogus path to `subset-font`.
        expectTypeOf(adapter.getFontPath).toEqualTypeOf<(style: string) => string | null>();
    });

    it('pins the GlyphData envelope the adapter emits', () => {
        // `svg` is required and `codepoint` optional precisely because this
        // set has no font distribution; flipping that optionality would make
        // every SVG-only adapter uncompilable.
        expectTypeOf<GlyphData>().toEqualTypeOf<{ codepoint?: number; svg: string }>();
    });
});
