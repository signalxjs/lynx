/**
 * `<MarkdownView>` — a SignalX-native, streaming-aware markdown renderer.
 *
 * A thin adapter over the richtext packages: `@sigx/richtext-markdown`'s
 * incremental engine parses the reactive `value` into an mdast tree, and
 * `@sigx/richtext`'s schema-driven render engine walks that tree through a
 * Lynx {@link LynxMarkdownComponents} map, so the same parser and the same
 * stable-block semantics drive Lynx, the DOM and any other renderer. For an
 * editable counterpart, see `MarkdownEditor`.
 *
 * Rendering is **generic**: the package ships neutral, theme-agnostic defaults
 * and exposes a `components` map so any design system can fully control the look
 * (e.g. `@sigx/lynx-daisyui`'s `markdownComponents`).
 *
 * The `value` prop is reactive: as it grows (e.g. driven by an AI token loop via
 * `createTextStream`), finalized blocks keep a stable identity and are
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
import { createReparseEngine, createSchema, renderDocument, standardNodes, type IncrementalEngine, type LinkHandler, type RenderContext, type RichTextPlugin, type Schema } from '@sigx/richtext';
import { markdownFormat } from '@sigx/richtext-markdown';
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
     * `@sigx/richtext` plugins (node specs, markdown syntax under
     * `formats.markdown`, serializer rules). A plugin node renders through
     * `components[node.type]` (e.g. `components.mention`), else its spec's
     * text projection. Pass a stable array (e.g. a module constant) — changing
     * its identity resets the incremental parse state and re-parses from scratch.
     */
    & Define.Prop<'plugins', readonly RichTextPlugin[], false>;

/** The streaming engine for a plugin list: markdown's incremental one, else (a format without one) a plain reparse. */
function engineFor(plugins: readonly RichTextPlugin[] | undefined): IncrementalEngine {
    return markdownFormat.createIncrementalEngine?.({ plugins }) ?? createReparseEngine((source) => markdownFormat.parse(source, { plugins }));
}

/** The schema a plugin list implies: the standard specs, markdown's and every plugin's `nodes`. */
function schemaFor(plugins: readonly RichTextPlugin[] | undefined): Schema {
    return createSchema([...standardNodes, ...(markdownFormat.nodes ?? []), ...(plugins ?? []).flatMap((p) => p.nodes ?? [])]);
}

export const MarkdownView = component<MarkdownViewProps>(({ props }) => {
    // The engine captures its plugins at construction; recreate it if the
    // plugins prop changes identity (rare — normally a stable constant).
    let plugins = props.plugins;
    let engine = engineFor(plugins);
    let schema = schemaFor(plugins);
    const root = computed(() => {
        if (props.plugins !== plugins) {
            plugins = props.plugins;
            engine = engineFor(plugins);
            schema = schemaFor(plugins);
        }
        return engine.parse(props.value ?? '');
    });

    return () => {
        const tree = root.value; // read first: it may swap `schema`
        const base: LynxMarkdownComponents = props.components
            ? { ...defaultComponents, ...props.components }
            : defaultComponents;
        // The engine's `image` props carry no tap handler — thread the view's
        // `onImageTap` into the slot so the Lynx renderer can offer one.
        const onImageTap = props.onImageTap;
        const image = base.image;
        const ctx: RenderContext<JSXElement> = {
            components: {
                ...base,
                ...(image
                    ? {
                          image: (p: LynxImageProps) => {
                              const lynxProps: LynxImageProps = { ...p, onImageTap };
                              return image(lynxProps);
                          },
                      }
                    : {}),
            },
            schema,
            onLink: props.onLink,
        };
        return renderDocument(tree, ctx);
    };
});
