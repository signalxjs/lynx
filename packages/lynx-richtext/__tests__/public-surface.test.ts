/**
 * Public-surface freeze test for @sigx/lynx-richtext.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect, plus the
 *    method set of the `RichTextMethods` namespace (C1) — that object is the
 *    entire BG→MT command surface, and native has to implement every name on
 *    it.
 *  - Types: the load-bearing signatures. This package has no `isAvailable`,
 *    no permissions and no subscriptions; what it does have is a wire model
 *    (`RichDoc`) shared verbatim with iOS/Android and with
 *    `@sigx/lynx-markdown`, so the codec signatures and the doc shape are the
 *    things whose drift would silently corrupt documents.
 *
 * Note: this package has no `.web.ts` sibling, so there is no web-parity
 * block (D7.1b) to assert. Its web support is a custom element shipped on the
 * separate `./web-element` entry point (`src/web/element.ts`), which is not
 * swapped in by `extensionAlias` and is covered by `web-element-*.test.ts`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as richtext from '../src/index';
import { RichTextMethods, decodeDoc, docEquals, emptyDoc, encodeDoc, normalizeDoc } from '../src/index';
import type { BlockAttr, InlineSpan, RichDoc, RichTextHandle } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(richtext).sort()).toEqual(
            [
                // Component
                'RichTextInput',
                // BG→MT command namespace
                'RichTextMethods',
                // Document codec — the one wire schema
                'encodeDoc',
                'decodeDoc',
                'docEquals',
                'normalizeDoc',
                'emptyDoc',
            ].sort(),
        );
    });

    it('exposes exactly the documented commands (C1)', () => {
        // Each key is a method name native dispatches on by string; adding one
        // here without the iOS/Android side is a silent no-op on device, and
        // renaming one breaks every existing app.
        expect(Object.keys(RichTextMethods).sort()).toEqual([
            'applyFormat',
            'blur',
            'focus',
            'insertChip',
            'insertText',
            'setBlockType',
            'setDocument',
            'setSelectionRange',
            'toggleFormat',
        ]);
    });
});

describe('public types', () => {
    it('keeps the commands fire-and-forget', () => {
        // Commands ride INVOKE_UI_METHOD one-way; state comes back through
        // `bindchange`/`bindselection`. A command that started returning a
        // Promise would invite `await`-ing a result that never reflects the
        // editor's real state.
        expectTypeOf(RichTextMethods.setDocument).toEqualTypeOf<
            (el: RichTextHandle, doc: RichDoc) => void
        >();
        expectTypeOf(RichTextMethods.focus).toEqualTypeOf<(el: RichTextHandle) => void>();
        expectTypeOf(RichTextMethods.applyFormat).toEqualTypeOf<
            (
                el: RichTextHandle,
                type: 'link',
                start: number,
                end: number,
                attrs?: { href?: string },
            ) => void
        >();
    });

    it('keeps the element handle nullable and structural', () => {
        // Callback refs fire with `null` on unmount, so every command has to
        // accept it; tightening this to a non-null handle would force callers
        // into guards the methods already do internally.
        expectTypeOf<RichTextHandle>().toEqualTypeOf<{ id: number } | null | undefined>();
    });

    it('pins the codec signatures', () => {
        // `decodeDoc` is deliberately total: it accepts the nullable strings
        // native events carry and degrades to an empty doc instead of
        // throwing on the BG thread.
        expectTypeOf(encodeDoc).toEqualTypeOf<(doc: RichDoc) => string>();
        expectTypeOf(decodeDoc).toEqualTypeOf<(raw: string | null | undefined) => RichDoc>();
        expectTypeOf(docEquals).toEqualTypeOf<(a: RichDoc, b: RichDoc) => boolean>();
        expectTypeOf(normalizeDoc).toEqualTypeOf<(doc: RichDoc) => RichDoc>();
        expectTypeOf(emptyDoc).toEqualTypeOf<(v?: number) => RichDoc>();
    });

    it('pins the document wire shape', () => {
        // This is the schema both native implementations and
        // @sigx/lynx-markdown parse; a field rename here is a cross-repo,
        // cross-language break, not a local refactor.
        expectTypeOf<RichDoc>().toEqualTypeOf<{
            text: string;
            spans: InlineSpan[];
            blocks: BlockAttr[];
            v: number;
        }>();
        // Offsets are UTF-16 code units on both sides of the bridge; `attrs`
        // stays string-valued because native carries it opaquely.
        expectTypeOf<InlineSpan['attrs']>().toEqualTypeOf<Record<string, string> | undefined>();
    });
});
