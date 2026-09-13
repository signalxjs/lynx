/**
 * `@sigx/lynx-emoji/markdown` — the MarkdownEditor integration (P3 plugin).
 * Separate subpath so the core picker stays decoupled from
 * `@sigx/lynx-markdown` (an optional peer; only this entry references it,
 * and only via `import type` — erased at runtime, so nothing here loads the
 * markdown package or its editor peers).
 *
 * What you get:
 *  - **trigger**: typing `:` opens the suggestion popup against the full
 *    dataset (same ranking as the picker's search). Selecting inserts the
 *    glyph itself by default (`insert: 'shortcode'` keeps `:smile:` text).
 *  - **syntax + component**: `:shortcode:` parses to an `emoji` node
 *    (`{ type: 'emoji', name, glyph }`) and previews as the glyph — wire into
 *    `MarkdownView` with `plugins={[{ name: 'emoji', nodes: [emojiNode], formats: { markdown: { inline: [createEmojiSyntax()] } } }]}`
 *    and `components={{ emoji: emojiComponent }}`. (Relevant for shortcode
 *    mode and for *parsing* messages that carry shortcodes; glyph mode
 *    output is plain text and needs neither.)
 *  - **toolbar** (optional): pass `onPickerRequest` to add a 😊 button that
 *    asks the app to open a picker surface (`KeyboardPanelPicker` /
 *    a sheet picker) — the editor doesn't own that UI.
 */

import type { JSXElement } from '@sigx/lynx';
import type { InlineSyntaxExtension, NodeSpec, Position, RichTextPlugin } from '@sigx/lynx-markdown';
import type { EditorPlugin, LynxTriggerExtras, TriggerItem, TriggerSpec } from '@sigx/lynx-markdown/editor';
import { data as enData } from '../data/en.gen.js';
import type { EmojiData, EmojiDatum } from '../data/schema.js';
import { buildSearchIndex } from '../search/index.js';

export interface EmojiPluginOptions {
    /** Locale dataset. Default: the bundled `en` data. */
    data?: EmojiData;
    /**
     * What a suggestion inserts into the document. `'glyph'` (default) is
     * WYSIWYG — plain text everywhere, no parser needed to display.
     * `'shortcode'` keeps `:smile:` source (renderable via the syntax
     * extension), matching the old showcase demo.
     */
    insert?: 'glyph' | 'shortcode';
    /** Max suggestions per query. Default 8. */
    limit?: number;
    /** Debounce between queries in ms (TriggerSpec passthrough). */
    debounce?: number;
    /** Re-skin a suggestion row (the neutral popup renders `label`). */
    renderItem?(item: TriggerItem, active: boolean): JSXElement;
    /**
     * When set, adds a 😊 toolbar item that calls this — the app's cue to
     * open its picker surface.
     */
    onPickerRequest?(): void;
}

/**
 * The `:shortcode:` node `createEmojiSyntax` produces. Register it in your
 * app to type it as phrasing content and its `components.emoji` slot:
 *
 * ```ts
 * declare module '@sigx/richtext' {
 *   interface PhrasingContentMap { emoji: EmojiNode }
 * }
 * ```
 */
export interface EmojiNode {
    type: 'emoji';
    /** The shortcode as written (without the colons). */
    name: string;
    /** The resolved glyph. */
    glyph: string;
    position?: Position;
}

/** The `emoji` node spec: an inline leaf that renders as its glyph without a component. */
export const emojiNode: NodeSpec = {
    type: 'emoji',
    role: 'inline',
    text: (node) => (node as unknown as EmojiNode).glyph || `:${(node as unknown as EmojiNode).name}:`,
};

const SHORTCODE_RE = /^:([a-z0-9_+-]+):/;
const DEFAULT_LIMIT = 8;

function shortcodeMap(data: EmojiData): Map<string, EmojiDatum> {
    const map = new Map<string, EmojiDatum>();
    for (const datum of data.emojis) {
        for (const sc of datum.sc ?? []) {
            if (!map.has(sc)) map.set(sc, datum);
        }
    }
    return map;
}

/**
 * The `:shortcode:` inline syntax. Streaming-safe like the mention syntax: a
 * partial tail (`:smi`) or an unknown shortcode stays literal text. The
 * matched node carries the resolved glyph.
 */
export function createEmojiSyntax(data: EmojiData = enData): InlineSyntaxExtension<EmojiNode> {
    const byShortcode = shortcodeMap(data);
    return {
        name: 'emoji',
        triggerChars: [':'],
        match(text, pos, ctx) {
            const m = SHORTCODE_RE.exec(text.slice(pos));
            if (!m) return null;
            const datum = byShortcode.get(m[1]);
            if (!datum) return null;
            const node: EmojiNode = { type: 'emoji', name: m[1], glyph: datum.e };
            const position = ctx.position(pos, pos + m[0].length);
            if (position) node.position = position;
            return { node, end: pos + m[0].length };
        },
    };
}

/** Preview renderer for the `emoji` node (`MarkdownView`'s `components.emoji` slot). */
export function emojiComponent({ node }: { node: EmojiNode }): string {
    return node.glyph || `:${node.name}:`;
}

/** An emoji plugin: a `RichTextPlugin` whose editor slice carries the `:` trigger (and the picker toolbar item). */
export function createEmojiPlugin(options?: EmojiPluginOptions): EditorPlugin & RichTextPlugin {
    const data = options?.data ?? enData;
    const insert = options?.insert ?? 'glyph';
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const index = buildSearchIndex(data);

    // Trigger-only on the editor side (like the original showcase demo):
    // glyph inserts are plain text, shortcode inserts stay raw source —
    // neither needs an inline kind in the editor document. The syntax is
    // still exposed (via createEmojiSyntax) for preview rendering.
    const trigger: TriggerSpec & LynxTriggerExtras = {
            char: ':',
            ...(options?.debounce !== undefined ? { debounce: options.debounce } : {}),
            onQuery(query) {
                if (query === '') return [];
                return index.search(query, limit).map((datum) => ({
                    // Stable id; the first shortcode names the suggestion.
                    id: datum.sc?.[0] ?? datum.e,
                    label: datum.sc?.[0] ? `${datum.e}  :${datum.sc[0]}:` : `${datum.e}  ${datum.n}`,
                    glyph: datum.e,
                    // Carried separately from `id` so onSelect can tell a real
                    // shortcode from the glyph fallback (sc is optional in the
                    // schema — `:😄:` would be unparseable).
                    ...(datum.sc?.[0] ? { sc: datum.sc[0] } : {}),
                }));
            },
            ...(options?.renderItem ? { renderItem: options.renderItem } : {}),
            onSelect(item, api) {
                const sc = typeof item.sc === 'string' ? item.sc : null;
                // Shortcode mode degrades to the glyph when the emoji has no
                // shortcode — never emit invalid `:<glyph>:` source.
                const text = insert === 'shortcode' && sc
                    ? `:${sc}: `
                    : `${typeof item.glyph === 'string' ? item.glyph : ''} `;
                // Trailing space = boundary, so the run doesn't re-trigger
                // (see TriggerSelectApi.replaceQuery).
                api.replaceQuery({ text, spans: [] });
            },
    };
    return {
        name: 'emoji',
        editor: {
            triggers: [trigger],
            ...(options?.onPickerRequest
                ? {
                    toolbar: [{
                        id: 'emoji',
                        label: '😊',
                        icon: 'smile',
                        group: 'insert',
                        isEnabled: () => true,
                        run: () => options.onPickerRequest!(),
                    }],
                }
                : {}),
        },
    };
}
