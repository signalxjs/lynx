/**
 * Public-surface freeze test for @sigx/lynx-icons.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`IconProps`, `IconAdapter`, `IconSpec`, …) are erased at runtime
 *    and are pinned below instead.
 *  - Types: the load-bearing shapes. This package ships no native module —
 *    it is pure JS with build-time glyph resolution — so there is no
 *    `isAvailable` (C2), no permission call (C6) and no subscription (C7) to
 *    freeze. What breaks consumers silently here is the *adapter contract*
 *    (`IconAdapter` is implemented outside this repo as well as by the
 *    `@sigx/lynx-icons-*` packages, and by `@sigx/lynx-plugin`'s icons slice)
 *    and the theme seam (`IconColorResolver` / `useIconColorResolver`).
 *
 * The `./context` subpath is a second, deliberately CSS-free entry point (the
 * theme engine imports the resolver key without pulling Icon's font/SVG
 * assets), so its surface is frozen separately — a re-export drifting between
 * the two entries is exactly the regression that would reintroduce the asset
 * pull.
 *
 * Note: this package has no `.web.ts` sibling — rendering goes through Lynx
 * elements on every target — so there is no web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as icons from '../src/index';
import { defineIconSet, useIconColorResolver } from '../src/index';
import * as iconsContext from '../src/context';
import type { GlyphData, GlyphSvg, IconAdapter, IconColorResolver, IconSetDef, IconSpec } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(icons).sort()).toEqual(
            [
                // The component itself
                'Icon',
                // Theme seam — the DI key a theme provides a resolver on
                'useIconColorResolver',
                // Runtime (ad-hoc) icon-set registration
                'defineIconSet',
            ].sort(),
        );
    });

    it('keeps the CSS-free ./context subpath minimal', () => {
        // Anything added here is pulled into the theme engine's barrel; the
        // point of the subpath is that it stays asset-free.
        expect(Object.keys(iconsContext).sort()).toEqual(['useIconColorResolver']);
        expect(iconsContext.useIconColorResolver).toBe(useIconColorResolver);
    });
});

describe('public types', () => {
    it('pins the theme colour seam', () => {
        // A resolver returning `undefined` is the documented "no opinion" case
        // that falls through to `props.color` / `currentColor`; widening the
        // return to `string` would make that fall-through unrepresentable, and
        // narrowing the props argument would break themes that read their own
        // declaration-merged fields off it.
        expectTypeOf<IconColorResolver>().toEqualTypeOf<
            (props: Readonly<Record<string, unknown>>) => string | undefined
        >();
        // Unprovided the injectable resolves to `null`, so consumers must keep
        // handling the no-theme case.
        expectTypeOf(useIconColorResolver()).toEqualTypeOf<IconColorResolver | null>();
    });

    it('pins defineIconSet as returning the registered definition', () => {
        // It returns the def (not void) so app code can keep a reference at
        // module scope: `const brand = defineIconSet({...})`.
        expectTypeOf(defineIconSet).toEqualTypeOf<(def: IconSetDef) => IconSetDef>();
        expectTypeOf<IconSetDef>().toEqualTypeOf<{
            id: string;
            glyphs: Record<string, { codepoint?: number; svg?: GlyphSvg }>;
            fontFamily?: string;
        }>();
    });

    it('pins the build-time adapter contract', () => {
        // Implemented by every `@sigx/lynx-icons-*` package and consumed by
        // the plugin's icons slice across a package boundary, so a changed
        // signature here fails at bundle time in someone else's repo.
        expectTypeOf<IconAdapter['getGlyph']>().toEqualTypeOf<
            (style: string, name: string) => GlyphData | null
        >();
        expectTypeOf<IconAdapter['getFontPath']>().toEqualTypeOf<(style: string) => string | null>();
        expectTypeOf<IconAdapter['listGlyphs']>().toEqualTypeOf<(style: string) => string[]>();
        expectTypeOf<IconAdapter['styles']>().toEqualTypeOf<string[]>();
    });

    it('keeps glyph data shapes distinct', () => {
        // `GlyphData.svg` is required (adapters must ship SVG markup) while a
        // runtime-registered `GlyphSvg` is the wrapped `{ svg }` form; the two
        // are easy to conflate and swapping them silently renders nothing.
        expectTypeOf<GlyphData>().toEqualTypeOf<{ codepoint?: number; svg: string }>();
        expectTypeOf<GlyphSvg>().toEqualTypeOf<{ svg: string }>();
    });

    it('keeps IconSpec a readonly data reference', () => {
        // The `{ set, name }` form travels through props of UI primitives
        // (`<Tabs.Screen icon={…}>`); readonly is what stops a consumer
        // mutating a shared spec object out from under a rendered icon.
        expectTypeOf<IconSpec>().toEqualTypeOf<{ readonly set: string; readonly name: string }>();
    });
});
