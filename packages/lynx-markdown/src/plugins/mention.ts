/**
 * The reference mention plugin — `@[label](id)` mentions as native chips.
 *
 * The platform-neutral halves live in `@sigx/markdown`: the syntax and
 * serializer (`mentionPlugin`) and the editor slice (`createMentionPlugin`
 * from `@sigx/markdown/editor`: the `mention` atom kind and the `@` trigger
 * whose pick replaces the query with a chip). This module is the **Lynx
 * half**: the candidate search with the label / id cleaning rule, the
 * popup row renderer, and an optional `mention` component for
 * `<MarkdownView>`.
 *
 * Label rule (the parser's, mirrored on the write path): a label cannot
 * contain `]` or CR/LF, an id cannot contain `)` or CR/LF — the serializer
 * strips exactly what the syntax refuses, so round-trips are idempotent by
 * construction.
 *
 * ```tsx
 * const mentions = createMentionPlugin({
 *     search: (q) => users.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())),
 * });
 * <MarkdownEditor plugins={[mentions]} />
 * ```
 */

import type { JSXElement } from '@sigx/lynx';
import { mentionPlugin, mentionSyntax, type MarkdownPlugin, type Mention } from '@sigx/markdown';
import { createMentionPlugin as createCoreMentionPlugin, mentionInlineKind, type InlineKindSpec, type MentionItem, type TriggerItem } from '@sigx/markdown/editor';
import type { LynxMarkdownChild } from '../render/components.js';
import type { SuggestionRenderItem } from '../editor/trigger/SuggestionPopup.js';

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
     * markdown (only `id`/`label`/`kind` do).
     */
    [key: string]: unknown;
}

/** What the mention preview component receives: the node (and no children — a mention is a leaf). */
export interface MentionComponentProps {
    node: Mention;
    children: LynxMarkdownChild[];
}

export interface MentionPluginOptions {
    /** Candidates for the text typed after `@`. May be async; stale results are discarded. */
    search(query: string): MentionCandidate[] | Promise<MentionCandidate[]>;
    /** Custom popup row (default: the label). */
    renderItem?: SuggestionRenderItem;
    /** Preview renderer for `<MarkdownView components={{ mention }}>` (returned as `component`). */
    component?: (props: MentionComponentProps) => JSXElement | string;
    /** Trigger character. Default `@`. */
    trigger?: string;
    /** Debounce between searches in ms. */
    debounce?: number;
}

/** A `MarkdownPlugin` whose editor slice carries the Lynx popup renderer. */
export interface LynxMentionPlugin extends MarkdownPlugin {
    component?: (props: MentionComponentProps) => JSXElement | string;
}

const cleanLabel = (s: string): string => s.replace(/[\]\r\n]/g, '');
const cleanId = (s: string): string => s.replace(/[)\r\n]/g, '');

/**
 * The Lynx mention kind keeps the candidate's `kind` on the node (a
 * display-only field for chip styling): it lives in the document and the
 * chip, never in the markdown (`@[label](id)` has no slot for it).
 */
export const lynxMentionInlineKind: InlineKindSpec = {
    ...mentionInlineKind,
    toFlat: (node) => {
        const m = node as unknown as Mention & { kind?: string };
        const attrs: Record<string, string> = { id: m.id, label: m.label };
        if (m.kind) attrs.kind = m.kind;
        return attrs;
    },
    fromFlat: (span) => {
        const n: Mention & { kind?: string } = { type: 'mention', id: span.attrs?.id ?? '', label: span.attrs?.label ?? '' };
        if (span.attrs?.kind) n.kind = span.attrs.kind;
        return n as unknown as ReturnType<NonNullable<InlineKindSpec['fromFlat']>>;
    },
};

export function createMentionPlugin(options: MentionPluginOptions): LynxMentionPlugin {
    const toItems = (candidates: MentionCandidate[]): MentionItem[] =>
        candidates
            // Spread first so display-only extras reach `renderItem`, then clean id/label last.
            .map((c) => ({ ...c, id: cleanId(c.id), label: cleanLabel(c.label) }))
            // A candidate that cleans to empty would serialize to @[]() — never offer it.
            .filter((c) => c.id !== '' && c.label !== '');
    const core = createCoreMentionPlugin({
        trigger: options.trigger,
        debounce: options.debounce,
        onQuery: (query) => {
            const result = options.search(query);
            return Array.isArray(result) ? toItems(result) : result.then(toItems);
        },
        attrsOf: (item: TriggerItem) => {
            const attrs: Record<string, string> = { id: cleanId(String(item.id)), label: cleanLabel(String(item.label)) };
            if (typeof item.kind === 'string' && item.kind) attrs.kind = item.kind;
            return attrs;
        },
    });
    const slice = core.editor!;
    const triggers = (slice.triggers ?? []).map((t) => (options.renderItem ? { ...t, renderItem: options.renderItem } : t));
    return {
        ...mentionPlugin,
        ...core,
        editor: { ...slice, inline: [lynxMentionInlineKind], triggers },
        ...(options.component ? { component: options.component } : {}),
    };
}
