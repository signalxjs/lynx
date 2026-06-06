/**
 * `@sigx/lynx-emoji/markdown` — the MarkdownEditor integration (P3 plugin).
 * Separate subpath so the core picker never loads `@sigx/lynx-markdown`
 * (an optional peer; only this entry imports it).
 *
 * What you get:
 *  - **trigger**: typing `:` opens the suggestion popup against the full
 *    dataset (same ranking as the picker's search). Selecting inserts the
 *    glyph itself by default (`insert: 'shortcode'` keeps `:smile:` text).
 *  - **syntax + component**: `:shortcode:` parses to an `emoji` extension
 *    node and previews as the glyph — wire into `MarkdownView` with
 *    `extensions={[plugin.inline!.syntax]}` …or `createEmojiSyntax()` —
 *    and `components={{ extension: { emoji: emojiExtensionComponent } }}`.
 *    (Relevant for shortcode mode and for *parsing* messages that carry
 *    shortcodes; glyph mode output is plain text and needs neither.)
 *  - **toolbar** (optional): pass `onPickerRequest` to add a 😊 button that
 *    asks the app to open a picker surface (`KeyboardPanelPicker` /
 *    `SheetPicker`) — the editor doesn't own that UI.
 */

import type { JSXElement } from '@sigx/lynx';
import type {
    ExtensionProps,
    MarkdownEditorPlugin,
    ParserInlineExtension,
    TriggerItem,
} from '@sigx/lynx-markdown';
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
 * The `:shortcode:` parser extension. Streaming-safe like the mention
 * syntax: a partial tail (`:smi`) or an unknown shortcode stays literal
 * text. The matched node carries the resolved glyph in `attrs.glyph`.
 */
export function createEmojiSyntax(data: EmojiData = enData): ParserInlineExtension {
    const byShortcode = shortcodeMap(data);
    return {
        name: 'emoji',
        triggerChars: [':'],
        match(text, pos) {
            const m = SHORTCODE_RE.exec(text.slice(pos));
            if (!m) return null;
            const datum = byShortcode.get(m[1]);
            if (!datum) return null;
            return {
                node: { type: 'extension', name: 'emoji', attrs: { name: m[1], glyph: datum.e }, raw: m[0] },
                end: pos + m[0].length,
            };
        },
    };
}

/** Preview renderer for the `emoji` extension node (`MarkdownView` slot). */
export function emojiExtensionComponent({ attrs }: ExtensionProps): string {
    return attrs.glyph ?? `:${attrs.name ?? ''}:`;
}

export function createEmojiPlugin(options?: EmojiPluginOptions): MarkdownEditorPlugin {
    const data = options?.data ?? enData;
    const insert = options?.insert ?? 'glyph';
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const index = buildSearchIndex(data);

    return {
        name: 'emoji',
        // Trigger-only on the editor side (like the original showcase demo):
        // glyph inserts are plain text, shortcode inserts stay raw source —
        // neither needs a span type in the editor document. The syntax is
        // still exposed (via createEmojiSyntax) for preview rendering.
        trigger: {
            char: ':',
            ...(options?.debounce !== undefined ? { debounce: options.debounce } : {}),
            onQuery(query) {
                if (query === '') return [];
                return index.search(query, limit).map((datum) => ({
                    // Stable id; the first shortcode names the suggestion.
                    id: datum.sc?.[0] ?? datum.e,
                    label: `${datum.e}  :${datum.sc?.[0] ?? datum.n}:`,
                    glyph: datum.e,
                }));
            },
            ...(options?.renderItem ? { renderItem: options.renderItem } : {}),
            onSelect(item, api) {
                const text = insert === 'glyph'
                    ? `${typeof item.glyph === 'string' ? item.glyph : ''} `
                    : `:${item.id}: `;
                // Trailing space = boundary, so the run doesn't re-trigger
                // (see TriggerSelectApi.replaceQuery).
                api.replaceQuery(text);
            },
        },
        ...(options?.onPickerRequest
            ? {
                toolbar: [{
                    id: 'emoji',
                    label: '😊',
                    icon: 'smile',
                    group: 'insert',
                    run: () => options.onPickerRequest!(),
                }],
            }
            : {}),
    };
}
