/**
 * Public-surface freeze test for @sigx/lynx-icons-fa-free.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect, for both
 *    published entry points — `.` (the build-time adapter) and `./components`
 *    (the pinned per-style JSX wrappers). Both are declared in
 *    `package.json#exports`, so both are consumer-visible surface.
 *  - Types: the adapter contract, because the plugin's icons slice calls these
 *    four members by name at build time — a signature drift here surfaces as a
 *    broken build in every consuming app, not as a test failure in this repo.
 *
 * Notes:
 *  - This is a build-time adapter, not a native module, so the conventions
 *    that govern runtime modules (C2 `isAvailable`, C5 `cancelled` unions,
 *    C6 permissions, C7 unsubscribers, C8 `MT`/`SV` hooks) have nothing to
 *    bind to here. The adapter contract is the load-bearing shape instead.
 *  - No `.web.ts` sibling exists — the adapter runs in the bundler, never on a
 *    target — so the web-parity block (D7.1b) is omitted.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { GlyphData, IconAdapter } from '@sigx/lynx-icons';
import * as faFree from '../src/index.js';
import adapter from '../src/index.js';
import * as components from '../src/components.js';

describe('public runtime exports', () => {
    it('matches the locked surface of the main entry', () => {
        // The adapter is a *default* export by design: `IconAdapter`'s doc
        // comment makes that the contract the plugin resolves against.
        expect(Object.keys(faFree).sort()).toEqual(['default']);
    });

    it('exposes exactly the documented adapter members', () => {
        // A new member reaching the plugin unannounced is the thing this
        // catches; `IconAdapter` in @sigx/lynx-icons has to grow with it.
        expect(Object.keys(adapter).sort()).toEqual([
            'getFontPath',
            'getGlyph',
            'listGlyphs',
            'styles',
        ]);
    });

    it('matches the locked surface of the ./components entry', () => {
        expect(Object.keys(components).sort()).toEqual(
            ['FaSolidIcon', 'FaRegularIcon', 'FaBrandIcon'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the default export to the shared adapter contract', () => {
        // Declaring the value `IconAdapter` in src is not enough on its own:
        // an extra member added to the object literal would still widen the
        // *exported* type. Pinning it here keeps the published type exactly
        // the contract the plugin compiles against.
        expectTypeOf(adapter).toEqualTypeOf<IconAdapter>();
    });

    it('pins the adapter method signatures', () => {
        // `style` and `name` stay plain strings rather than a union of the
        // three FA styles: the plugin passes user config through unvalidated,
        // and the adapter answers `null` / `[]` for anything it doesn't know.
        // Narrowing these would make that (tested) fallback uncallable.
        expectTypeOf(adapter.getGlyph).toEqualTypeOf<
            (style: string, name: string) => GlyphData | null
        >();
        expectTypeOf(adapter.getFontPath).toEqualTypeOf<(style: string) => string | null>();
        expectTypeOf(adapter.listGlyphs).toEqualTypeOf<(style: string) => string[]>();
        expectTypeOf(adapter.styles).toEqualTypeOf<string[]>();
    });

    it('keeps the glyph payload optional-codepoint, required-svg', () => {
        // SVG mode is the universal path; `codepoint` is the font-subsetting
        // optimisation only some adapters can supply. Flipping which one is
        // optional would silently break SVG-only adapters that share this type.
        expectTypeOf<GlyphData>().toEqualTypeOf<{ codepoint?: number; svg: string }>();
        expectTypeOf<GlyphData['svg']>().toEqualTypeOf<string>();
    });
});
