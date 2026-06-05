/**
 * The reference mention plugin — `@[label](id)` mentions as native chips.
 *
 * The proving consumer of the P3 plugin API (#156): one plugin wires all
 * three surfaces together —
 *
 *  - **parser**: `@[label](id)` parses to an `extension` node (streaming-safe:
 *    a half-typed `@[lab` stays literal text),
 *  - **editor field**: the node maps to a `mention` span over a single
 *    U+FFFC (the chip invariant — see `InlineSpanType` in lynx-richtext),
 *    rendered natively as a pill; selecting a suggestion inserts the chip
 *    via `controller.insertChip`, replacing the typed trigger run,
 *  - **markdown out**: the span serializes back to `@[label](id)` from its
 *    attrs (the covered text is the U+FFFC, never the label).
 *
 * v1 label rule: `]`, `)` and newlines are forbidden in labels/ids — the
 * serializer strips them and the parser regex doesn't match them.
 *
 * A factory (not a constant) because the consumer supplies the candidate
 * source:
 *
 * ```tsx
 * const mentions = createMentionPlugin({
 *     search: (q) => users.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())),
 * });
 * <MarkdownEditor plugins={[mentions]} />
 * ```
 */

import type { JSXElement } from '@sigx/lynx';
import type { InlineExtension } from '../ast.js';
import type { ParserInlineExtension } from '../parser/extensions.js';
import type { ExtensionProps, MarkdownChild } from '../render/components.js';
import type { MarkdownEditorPlugin, TriggerItem } from '../editor/plugin.js';

export interface MentionCandidate {
    id: string;
    label: string;
    kind?: string;
}

export interface MentionPluginOptions {
    /** Resolve candidates for the typed query (sync or async). */
    search(query: string): MentionCandidate[] | Promise<MentionCandidate[]>;
    /** Re-skin a suggestion row in the popup. */
    renderItem?(item: TriggerItem, active: boolean): JSXElement;
    /** Preview-pill renderer for `MarkdownView` (`components.extension.mention`). */
    component?: (props: ExtensionProps) => MarkdownChild;
    /** Popup trigger char (the markdown syntax stays `@[label](id)`). Default `'@'`. */
    trigger?: string;
    /** Debounce between `search` calls in ms. */
    debounce?: number;
}

/** `@[label](id)` — label/id exclude `]`/`)`/newlines (v1 rule). */
const MENTION_RE = /^@\[([^\]\n]+)\]\(([^)\n]+)\)/;

/** Enforce the v1 label rule on the write path. */
function clean(value: string): string {
    return value.replace(/[\])\n]/g, '');
}

/** The parser extension for `@[label](id)` (exported for MarkdownView previews). */
export const mentionSyntax: ParserInlineExtension = {
    name: 'mention',
    triggerChars: ['@'],
    match(text, pos) {
        const m = MENTION_RE.exec(text.slice(pos));
        if (!m) return null; // partial tail (`@[lab`) stays literal — streaming-safe
        return {
            node: {
                type: 'extension',
                name: 'mention',
                attrs: { label: m[1], id: m[2] },
                raw: m[0],
            },
            end: pos + m[0].length,
        };
    },
};

/** Neutral preview pill (override via `options.component`). */
function defaultComponent({ attrs }: ExtensionProps): MarkdownChild {
    return `@${attrs.label ?? ''}`;
}

export function createMentionPlugin(options: MentionPluginOptions): MarkdownEditorPlugin {
    const triggerChar = options.trigger ?? '@';
    return {
        name: 'mention',
        inline: {
            syntax: mentionSyntax,
            component: options.component ?? defaultComponent,
            serialize(span) {
                // The covered text is the chip's U+FFFC — serialize from attrs.
                const label = clean(span.attrs?.label ?? '');
                const id = clean(span.attrs?.id ?? '');
                return `@[${label}](${id})`;
            },
            docMapping: {
                spanType: 'mention',
                toSpan(node: InlineExtension) {
                    // The chip invariant: one U+FFFC in the text, label in attrs.
                    return {
                        text: '\uFFFC',
                        span: {
                            type: 'mention',
                            attrs: { id: node.attrs.id ?? '', label: node.attrs.label ?? '' },
                        },
                    };
                },
            },
        },
        trigger: {
            char: triggerChar,
            ...(options.debounce !== undefined ? { debounce: options.debounce } : {}),
            onQuery(query) {
                const result = options.search(query);
                const toItems = (candidates: MentionCandidate[]): TriggerItem[] =>
                    candidates.map((c) => ({
                        id: c.id,
                        label: c.label,
                        ...(c.kind !== undefined ? { kind: c.kind } : {}),
                    }));
                return Array.isArray(result) ? toItems(result) : result.then(toItems);
            },
            ...(options.renderItem ? { renderItem: options.renderItem } : {}),
            onSelect(item, api) {
                api.controller.insertChip(
                    {
                        id: item.id,
                        label: item.label,
                        ...(typeof item.kind === 'string' ? { kind: item.kind } : {}),
                    },
                    { from: api.range.start, to: api.range.end },
                );
            },
        },
    };
}
