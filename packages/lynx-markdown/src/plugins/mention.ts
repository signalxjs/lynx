/**
 * The reference mention plugin — `@[label](id)` mentions as native chips.
 *
 * The platform-neutral half — the `@[label](id)` syntax (`mentionSyntax`),
 * the `{ type: 'mention', id, label }` node and its serializer — lives in
 * `@sigx/markdown` (`mentionPlugin`, re-exported here so `<MarkdownView
 * plugins={[mentionPlugin]}>` needs one import). This module is the **editor
 * half**, the proving consumer of the plugin API (#156):
 *
 *  - **editor field**: the node maps to a `mention` span over a single
 *    U+FFFC (the chip invariant — see `InlineSpanType` in lynx-richtext),
 *    rendered natively as a pill; selecting a suggestion inserts the chip
 *    via `controller.insertChip`, replacing the typed trigger run,
 *  - **markdown out**: the span serializes back to `@[label](id)` from its
 *    attrs (the covered text is the U+FFFC, never the label),
 *  - **preview**: an optional `mention` component for `<MarkdownView>`.
 *
 * Label rule (the parser's, mirrored on the write path): a label cannot
 * contain `]` or CR/LF, an id cannot contain `)` or CR/LF — the serializer
 * strips exactly what the syntax refuses, so round-trips are idempotent by
 * construction.
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
import { mentionPlugin, mentionSyntax, serializeMention, type Mention } from '@sigx/markdown';
import type { LynxMarkdownChild } from '../render/components.js';
import type { MarkdownEditorPlugin, TriggerItem } from '../editor/plugin.js';

export { mentionPlugin, mentionSyntax };
export type { Mention };

export interface MentionCandidate {
    id: string;
    label: string;
    kind?: string;
    /**
     * Extra **display-only** fields (e.g. `avatar`, `subtitle`) — carried
     * through to the suggestion row's `renderItem` as `item.<field>` for a
     * richer popup UI. They never reach the chip payload or the serialized
     * markdown (only `id`/`label`/`kind` do), so they can hold anything the row
     * needs without affecting round-tripping.
     */
    [key: string]: unknown;
}

/** What the mention preview component receives: the node (and no children — a mention is a leaf). */
export interface MentionComponentProps {
    node: Mention;
    children: LynxMarkdownChild[];
}

export interface MentionPluginOptions {
    /** Resolve candidates for the typed query (sync or async). */
    search(query: string): MentionCandidate[] | Promise<MentionCandidate[]>;
    /** Re-skin a suggestion row in the popup. */
    renderItem?(item: TriggerItem, active: boolean): JSXElement;
    /**
     * Preview-pill renderer, exposed as `plugin.inline.component`.
     * `MarkdownView` is not editor-plugin-aware — wire it up explicitly:
     * `components={{ mention: plugin.inline.component }}` (with
     * `plugins={[mentionPlugin]}`).
     */
    component?: (props: MentionComponentProps) => LynxMarkdownChild;
    /** Popup trigger char (the markdown syntax stays `@[label](id)`). Default `'@'`. */
    trigger?: string;
    /** Debounce between `search` calls in ms. */
    debounce?: number;
}

/** Enforce the label rule on the write path (the same set `mentionSyntax` refuses). */
function cleanLabel(value: string): string {
    return value.replace(/[\]\r\n]/g, '');
}
function cleanId(value: string): string {
    return value.replace(/[)\r\n]/g, '');
}

/** Neutral preview pill (override via `options.component`). */
function defaultComponent({ node }: MentionComponentProps): LynxMarkdownChild {
    return `@${node.label}`;
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
                const label = cleanLabel(span.attrs?.label ?? '');
                const id = cleanId(span.attrs?.id ?? '');
                // Malformed span (missing or cleaned-to-empty payload):
                // degrade to the plain label rather than emitting
                // unparseable syntax like @[]().
                if (label === '' || id === '') return label;
                return serializeMention({ type: 'mention', id, label });
            },
            docMapping: {
                spanType: 'mention',
                toSpan(node: Mention) {
                    // The chip invariant: one U+FFFC in the text, label in attrs.
                    return {
                        text: '\uFFFC',
                        span: {
                            type: 'mention',
                            attrs: { id: node.id, label: node.label },
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
                // Sanitize at the boundary: the popup must show exactly what
                // the chip will carry and what the markdown will emit — a
                // candidate with forbidden chars must not display one label
                // and serialize another.
                const toItems = (candidates: MentionCandidate[]): TriggerItem[] =>
                    candidates
                        // Spread the candidate first so display-only extras
                        // (avatar, subtitle, …) reach `renderItem`, then clean
                        // id/label last so the chip payload/markdown stay safe
                        // regardless of what the extras carry.
                        .map((c) => ({
                            ...c,
                            id: cleanId(c.id),
                            label: cleanLabel(c.label),
                        }))
                        // A candidate that cleans to empty would serialize to
                        // @[]() — unparseable. Never offer it.
                        .filter((c) => c.id !== '' && c.label !== '');
                return Array.isArray(result) ? toItems(result) : result.then(toItems);
            },
            ...(options.renderItem ? { renderItem: options.renderItem } : {}),
            onSelect(item, api) {
                // Defense in depth — items normally arrive pre-cleaned from
                // onQuery, but the chip payload must obey the label rule even
                // if a consumer drives onSelect directly. An empty cleaned
                // payload would serialize to @[]() (unparseable) — and the
                // native insertChip rejects it anyway — so skip the insert.
                const id = cleanId(item.id);
                const label = cleanLabel(item.label);
                if (id === '' || label === '') return;
                api.controller.insertChip(
                    {
                        id,
                        label,
                        ...(typeof item.kind === 'string' ? { kind: item.kind } : {}),
                    },
                    { from: api.range.start, to: api.range.end },
                );
            },
        },
    };
}
