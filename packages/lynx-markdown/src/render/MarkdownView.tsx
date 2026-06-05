/**
 * `<MarkdownView>` — a SignalX-native, streaming-aware markdown renderer.
 *
 * Parses markdown in JS (zero dependencies) and renders to Lynx primitives, so
 * it works identically on every platform. For an editable counterpart, see
 * `MarkdownEditor`.
 *
 * Rendering is **generic**: the package ships neutral, theme-agnostic defaults
 * and exposes a `components` map so any design system can fully control the look
 * (e.g. `@sigx/lynx-daisyui`'s `markdownComponents`). See
 * {@link MarkdownComponents}.
 *
 * The `value` prop is reactive: as it grows (e.g. driven by an AI token loop via
 * {@link createMarkdownStream}), finalized blocks keep a stable identity and are
 * never re-parsed or remounted, so completed content does not flicker or reflow.
 *
 * @example
 * ```tsx
 * import { MarkdownView } from '@sigx/lynx-markdown';
 * import { markdownComponents } from '@sigx/lynx-daisyui';
 *
 * <MarkdownView value={md} components={markdownComponents} onLink={openUrl} />
 * ```
 */

import { component, computed, type Define } from '@sigx/lynx';
import type { ParserInlineExtension } from '../parser/extensions.js';
import { createIncrementalEngine } from '../parser/incremental.js';
import { defaultComponents, type MarkdownComponents } from './components.js';
import { renderDocument, type RenderContext } from './engine.js';

export type MarkdownViewProps =
    & Define.Prop<'value', string, false>
    & Define.Prop<'onLink', (href: string) => void, false>
    & Define.Prop<'onImageTap', (src: string) => void, false>
    & Define.Prop<'components', Partial<MarkdownComponents>, false>
    /**
     * Plugin inline extensions (see {@link ParserInlineExtension}). Pass a
     * stable array (e.g. a module constant) — changing its identity resets
     * the incremental parse state and re-parses from scratch.
     */
    & Define.Prop<'extensions', readonly ParserInlineExtension[], false>;

export const MarkdownView = component<MarkdownViewProps>(({ props }) => {
    // The engine captures its extensions at construction; recreate it if the
    // extensions prop changes identity (rare — normally a stable constant).
    let engine = createIncrementalEngine({ extensions: props.extensions });
    let lastExtensions = props.extensions;
    const blocks = computed(() => {
        if (props.extensions !== lastExtensions) {
            lastExtensions = props.extensions;
            engine = createIncrementalEngine({ extensions: lastExtensions });
        }
        return engine.parse(props.value ?? '');
    });

    return () => {
        const ctx: RenderContext = {
            components: props.components
                ? { ...defaultComponents, ...props.components }
                : defaultComponents,
            onLink: props.onLink,
            onImageTap: props.onImageTap,
        };
        return renderDocument(blocks.value, ctx);
    };
});
