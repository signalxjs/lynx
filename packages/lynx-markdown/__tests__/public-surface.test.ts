/**
 * Public-surface freeze test for @sigx/lynx-markdown.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect, for both
 *    published entries — the root and the `/editor` subpath. Type-only exports
 *    (`MarkdownViewProps`, `MarkdownComponents`, the whole AST via
 *    `export type * from './ast.js'`, …) are erased at runtime and are pinned
 *    below instead.
 *  - Types: the load-bearing signatures — the factories consumers hold onto,
 *    and the reactive shapes whose `.value` drives re-render (C8).
 *
 * The two entries are asserted separately on purpose: the split exists so the
 * root carries no runtime import of the optional `@sigx/lynx-richtext` /
 * `@sigx/lynx-keyboard` peers (#177). An editor export leaking back into the
 * root barrel would make those peers required at module-link time for every
 * renderer-only consumer — the root snapshot below is what catches that.
 *
 * This is a rendering/parsing package with no native module behind it, so
 * there is no `isAvailable` to pin (C2) and no `.web.ts` sibling, hence no
 * web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as markdown from '../src/index';
import * as editor from '../src/editor/index';
import type { BlockNode, InlineNode } from '../src/ast';
import type { ParserInlineExtension } from '../src/parser/extensions';
import type { IncrementalEngine, MarkdownStream } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked root surface', () => {
        expect(Object.keys(markdown).sort()).toEqual(
            [
                // Renderer
                'MarkdownView',
                'defaultComponents',
                // Reference plugin
                'createMentionPlugin',
                'mentionSyntax',
                // Streaming controller for AI token loops
                'createMarkdownStream',
                // Parser primitives (advanced consumers / testing)
                'createIncrementalEngine',
                'parseBlocks',
                'parseInline',
            ].sort(),
        );
    });

    it('matches the locked /editor subpath surface', () => {
        expect(Object.keys(editor).sort()).toEqual(
            [
                'MarkdownEditor',
                'EditorToolbar',
                'defaultToolbarItems',
                // Markdown <-> RichDoc conversion
                'mdToDoc',
                'docToMd',
                // Trigger/suggestion machinery
                'SuggestionPopup',
                'derivePopupStyleFromText',
                'createTriggerSessionManager',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the streaming controller shape (C8: `.value` is the reactive read)', () => {
        // `<MarkdownView value={stream.value.value} />` is the documented
        // usage: `value` must stay a signal, not the string itself, or every
        // consumer silently stops re-rendering as tokens arrive.
        expectTypeOf(markdown.createMarkdownStream).parameters.toEqualTypeOf<
            [opts?: { flushIntervalMs?: number }]
        >();
        expectTypeOf(markdown.createMarkdownStream()).toEqualTypeOf<MarkdownStream>();
        expectTypeOf<MarkdownStream['value']['value']>().toEqualTypeOf<string>();
        expectTypeOf<MarkdownStream['finished']['value']>().toEqualTypeOf<boolean>();
        expectTypeOf<MarkdownStream['append']>().toEqualTypeOf<(chunk: string) => void>();
    });

    it('pins the parser primitives', () => {
        // Extensions are `readonly` and optional on both entry points — a
        // plugin array is meant to be a module constant passed by identity
        // (changing identity resets incremental parse state).
        expectTypeOf(markdown.parseInline).toEqualTypeOf<
            (input: string, extensions?: readonly ParserInlineExtension[]) => InlineNode[]
        >();
        expectTypeOf(markdown.parseBlocks).returns.toEqualTypeOf<BlockNode[]>();
        expectTypeOf(markdown.createIncrementalEngine).toEqualTypeOf<
            (options?: { extensions?: readonly ParserInlineExtension[] }) => IncrementalEngine
        >();
        // The reuse contract: `parse` returns finalized blocks by reference and
        // `reset` is the only way to drop them.
        expectTypeOf<IncrementalEngine['parse']>().toEqualTypeOf<(src: string) => BlockNode[]>();
        expectTypeOf<IncrementalEngine['reset']>().toEqualTypeOf<() => void>();
    });

    it('pins the mention plugin as the proving consumer of the extension API', () => {
        // `mentionSyntax` is what consumers pass to `<MarkdownView extensions>`
        // when they render mentions without the editor; it has to stay a plain
        // `ParserInlineExtension` value, not a factory.
        expectTypeOf(markdown.mentionSyntax).toEqualTypeOf<ParserInlineExtension>();
        expectTypeOf(markdown.createMentionPlugin).parameters.toMatchTypeOf<[unknown]>();
    });

    it('pins the editor conversion round-trip', () => {
        // `docToMd(mdToDoc(src))` is the round-trip every editor save depends
        // on; the `v` version arg on `mdToDoc` is positional and easy to drop.
        expectTypeOf(editor.mdToDoc).parameter(0).toEqualTypeOf<string>();
        expectTypeOf(editor.mdToDoc).parameter(1).toEqualTypeOf<number | undefined>();
        expectTypeOf(editor.docToMd).returns.toEqualTypeOf<string>();
    });

    it('keeps the trigger session manager subscription-shaped (C7-adjacent)', () => {
        // `close()` is the teardown a consumer must be able to call
        // unconditionally on blur; the session itself is nullable because
        // "no active trigger" is a real state, not an error.
        expectTypeOf<
            ReturnType<typeof editor.createTriggerSessionManager>['close']
        >().toEqualTypeOf<() => void>();
        expectTypeOf(editor.derivePopupStyleFromText).parameter(0).toEqualTypeOf<
            string | undefined
        >();
    });
});
