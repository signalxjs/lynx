/**
 * `<MarkdownView>` — a SignalX-native, streaming-aware markdown renderer.
 *
 * A thin adapter over `@sigx/markdown`: its incremental engine parses the
 * reactive `value` into an mdast tree, and its platform-neutral render engine
 * walks that tree through a Lynx {@link LynxMarkdownComponents} map, so the
 * same parser and the same stable-block semantics drive Lynx, the DOM and any
 * other renderer. For an editable counterpart, see `MarkdownEditor`.
 *
 * Rendering is **generic**: the package ships neutral, theme-agnostic defaults
 * and exposes a `components` map so any design system can fully control the look
 * (e.g. `@sigx/lynx-daisyui`'s `markdownComponents`).
 *
 * The `value` prop is reactive: as it grows (e.g. driven by an AI token loop via
 * `createMarkdownStream`), finalized blocks keep a stable identity and are
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

import { component, computed, type Define, type JSXElement } from '@sigx/lynx';
import {
    createIncrementalEngine,
    renderDocument,
    resolvePlugins,
    type LinkHandler,
    type MarkdownPlugin,
    type RenderContext,
} from '@sigx/markdown';
import { defaultComponents, type LynxImageProps, type LynxMarkdownComponents } from './components.js';

export type MarkdownViewProps =
    & Define.Prop<'value', string, false>
    /** A link was tapped. Receives the sanitised URL and the `link` node. */
    & Define.Prop<'onLink', LinkHandler, false>
    /** An image was tapped (the default `image` renders as a tappable label). */
    & Define.Prop<'onImageTap', (url: string) => void, false>
    /** Per-node-type render overrides; unspecified slots fall back to `defaultComponents`. */
    & Define.Prop<'components', Partial<LynxMarkdownComponents>, false>
    /**
     * `@sigx/markdown` plugins (inline/block syntax, serializer rules — see
     * `MarkdownPlugin`). A plugin node renders through `components[node.type]`
     * (e.g. `components.mention`). Pass a stable array (e.g. a module
     * constant) — changing its identity resets the incremental parse state
     * and re-parses from scratch.
     */
    & Define.Prop<'plugins', readonly MarkdownPlugin[], false>;

export const MarkdownView = component<MarkdownViewProps>(({ props }) => {
    // The engine captures its plugins at construction; recreate it if the
    // plugins prop changes identity (rare — normally a stable constant).
    let plugins = props.plugins;
    let engine = createIncrementalEngine({ plugins });
    let resolved = resolvePlugins(plugins);
    const root = computed(() => {
        if (props.plugins !== plugins) {
            plugins = props.plugins;
            engine = createIncrementalEngine({ plugins });
            resolved = resolvePlugins(plugins);
        }
        return engine.parse(props.value ?? '');
    });

    return () => {
        const tree = root.value; // read first: it may swap `resolved`
        const base: LynxMarkdownComponents = props.components
            ? { ...defaultComponents, ...props.components }
            : defaultComponents;
        // The engine's `image` props carry no tap handler — thread the view's
        // `onImageTap` into the slot so the Lynx renderer can offer one.
        const onImageTap = props.onImageTap;
        const ctx: RenderContext<JSXElement> = {
            components: {
                ...base,
                image: (p) => {
                    const lynxProps: LynxImageProps = { ...p, onImageTap };
                    return base.image(lynxProps);
                },
            },
            plugins: resolved,
            onLink: props.onLink,
        };
        return renderDocument(tree, ctx);
    };
});
