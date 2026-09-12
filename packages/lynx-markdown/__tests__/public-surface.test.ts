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
 *    (`MarkdownViewProps`, the Lynx component-map aliases, the whole
 *    `@sigx/markdown` type surface via `export type * from '@sigx/markdown'`,
 *    …) are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures — the factories consumers hold onto,
 *    and the reactive shapes whose `.value` drives re-render (C8).
 *
 * The two entries are asserted separately on purpose: the split exists so the
 * root carries no runtime import of the optional `@sigx/lynx-richtext` /
 * `@sigx/lynx-keyboard` peers (#177). An editor export leaking back into the
 * root barrel would make those peers required at module-link time for every
 * renderer-only consumer — the root snapshot below is what catches that.
 *
 * The parser, stream and render engine live in `@sigx/markdown` (#1112); the
 * root re-exports the handful a Lynx app reaches for, and the snapshot pins
 * that set so the re-export list cannot silently grow into a second copy of
 * the upstream surface.
 *
 * This is a rendering/parsing package with no native module behind it, so
 * there is no `isAvailable` to pin (C2) and no `.web.ts` sibling, hence no
 * web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { JSXElement } from '@sigx/lynx';
import * as upstream from '@sigx/markdown';

import * as upstreamEditor from '@sigx/markdown/editor';
import type { Command, Editor, InlineFlat } from '@sigx/markdown/editor';
import type { BlockAttrType } from '@sigx/lynx-richtext';
import * as markdown from '../src/index';
import * as editor from '../src/editor/index';
import type { MarkdownEditorController } from '../src/editor/index';
import type {
    IncrementalEngine,
    InlineSyntaxExtension,
    LynxImageProps,
    LynxMarkdownComponents,
    MarkdownComponents,
    MarkdownPlugin,
    MarkdownStream,
    Mention,
    Root,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked root surface', () => {
        expect(Object.keys(markdown).sort()).toEqual(
            [
                // Renderer
                'MarkdownView',
                'defaultComponents',
                // Reference plugin (editor half here, syntax half from @sigx/markdown)
                'createMentionPlugin',
                'mentionSyntax',
                'mentionPlugin',
                // @sigx/markdown primitives re-exported for Lynx apps
                'createMarkdownStream',
                'createIncrementalEngine',
                'parseMarkdown',
                'renderDocument',
            ].sort(),
        );
    });

    it('re-exports the @sigx/markdown values by identity (one parser, one engine)', () => {
        expect(markdown.createMarkdownStream).toBe(upstream.createMarkdownStream);
        expect(markdown.createIncrementalEngine).toBe(upstream.createIncrementalEngine);
        expect(markdown.parseMarkdown).toBe(upstream.parseMarkdown);
        expect(markdown.renderDocument).toBe(upstream.renderDocument);
        expect(markdown.mentionSyntax).toBe(upstream.mentionSyntax);
        expect(markdown.mentionPlugin).toBe(upstream.mentionPlugin);
    });

    it('matches the locked /editor subpath surface', () => {
        expect(Object.keys(editor).sort()).toEqual(
            [
                // The component and its chrome
                'MarkdownEditor',
                'EditorToolbar',
                'SuggestionPopup',
                'derivePopupStyleFromText',
                // Block views (for hosts composing their own layout)
                'BlockView',
                'InlineBlock',
                'CodeBlock',
                'useLynxEditorView',
                'createLynxEditorView',
                // The Lynx surfaces over <sigx-richtext> / <textarea>
                'createLynxInlineSurface',
                'createLynxCodeSurface',
                'flatToDoc',
                'docToFlat',
                'blockAttrFor',
                // The core's editor API, re-exported (one import for Lynx apps)
                'defaultToolbarItems',
                'toolbarState',
                'createSlashPlugin',
                'createCoreMentionPlugin',
                'createTriggerSessionManager',
                'commands',
                'commandRegistry',
                'createEditor',
            ].sort(),
        );
    });

    it('re-exports the @sigx/markdown editor values by identity (one core)', () => {
        expect(editor.createEditor).toBe(upstreamEditor.createEditor);
        expect(editor.defaultToolbarItems).toBe(upstreamEditor.defaultToolbarItems);
        expect(editor.createTriggerSessionManager).toBe(upstreamEditor.createTriggerSessionManager);
        expect(editor.createSlashPlugin).toBe(upstreamEditor.createSlashPlugin);
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
        // Plugins are `readonly` and optional on both entry points — a plugin
        // array is meant to be a module constant passed by identity (changing
        // identity resets incremental parse state).
        expectTypeOf(markdown.parseMarkdown).toEqualTypeOf<
            (src: string, options?: { plugins?: readonly MarkdownPlugin[] }) => Root
        >();
        expectTypeOf(markdown.createIncrementalEngine).toEqualTypeOf<
            (options?: { plugins?: readonly MarkdownPlugin[] }) => IncrementalEngine
        >();
        // The reuse contract: `parse` returns finalized blocks by reference and
        // `reset` is the only way to drop them.
        expectTypeOf<IncrementalEngine['parse']>().toEqualTypeOf<(src: string) => Root>();
        expectTypeOf<IncrementalEngine['reset']>().toEqualTypeOf<() => void>();
    });

    it('pins the Lynx component map as @sigx/markdown\'s contract over JSXElement', () => {
        // Design systems type their map against this; the aliases must stay
        // exactly the upstream generic instantiated with the Lynx element.
        expectTypeOf<LynxMarkdownComponents>().toEqualTypeOf<MarkdownComponents<JSXElement>>();
        expectTypeOf(markdown.defaultComponents).toEqualTypeOf<MarkdownComponents<JSXElement>>();
        // The one Lynx extension of the upstream props: `image` also sees the
        // view's `onImageTap`.
        expectTypeOf<LynxImageProps['onImageTap']>().toEqualTypeOf<((url: string) => void) | undefined>();
        expectTypeOf<LynxImageProps['url']>().toEqualTypeOf<string>();
    });

    it('pins the mention plugin as the proving consumer of the plugin API', () => {
        // `mentionPlugin`/`mentionSyntax` are what consumers pass to
        // `<MarkdownView plugins>` when they render mentions without the
        // editor; they have to stay plain values, not factories.
        expectTypeOf(markdown.mentionSyntax).toEqualTypeOf<InlineSyntaxExtension<Mention>>();
        expectTypeOf(markdown.mentionPlugin).toEqualTypeOf<MarkdownPlugin>();
        expectTypeOf(markdown.createMentionPlugin).parameters.toMatchTypeOf<[unknown]>();
    });

    it('pins the flat <-> RichDoc mapping (the surface contract over the element)', () => {
        // `flatToDoc` takes the version positionally; a dropped `v` would
        // make every write look stale to the element.
        expectTypeOf(editor.flatToDoc).parameter(2).toEqualTypeOf<number>();
        expectTypeOf(editor.docToFlat).returns.toEqualTypeOf<InlineFlat>();
        expectTypeOf(editor.blockAttrFor).returns.toEqualTypeOf<{ type: BlockAttrType; level?: number }>();
    });

    it('pins the controller as a superset of the core editor (C1)', () => {
        expectTypeOf<MarkdownEditorController['editor']>().toEqualTypeOf<Editor>();
        expectTypeOf<MarkdownEditorController['run']>().toEqualTypeOf<(command: Command | string) => boolean>();
        expectTypeOf<MarkdownEditorController['getDocument']>().toEqualTypeOf<() => Root>();
        expectTypeOf<MarkdownEditorController['insertChip']>().toEqualTypeOf<(chip: { id: string; label: string; kind?: string }, replace?: { from: number; to: number }) => void>();
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
