/**
 * The `MarkdownEditor` plugin contract — the P3 pluggability layer. Another
 * project adds e.g. mention support without touching this package:
 *
 * - `inline` teaches the **parser** the syntax (a {@link ParserInlineExtension}),
 *   the **editor field** how to model it (`docMapping`: AST node → editor span)
 *   and how to write it back out (`serialize`: span → markdown), and optionally
 *   the **preview** how to render it (`component`).
 * - `trigger` opens a suggestion session on a trigger char (`@`, `:`), feeds it
 *   query results, and inserts the selection.
 * - `toolbar` contributes {@link ToolbarItem}s to the built-in toolbar.
 *
 * Every part is optional and independent — a plugin can be toolbar-only, or
 * trigger-only (e.g. a slash-command menu that inserts plain markdown).
 */

import type { JSXElement } from '@sigx/lynx';
import type { InlineSpan } from '@sigx/lynx-richtext';
import type { InlineExtension } from '../ast.js';
import type { ParserInlineExtension } from '../parser/extensions.js';
import type { ExtensionProps, MarkdownChild } from '../render/components.js';
import type { ToolbarItem } from './toolbar/items.js';
import type { MarkdownEditorController } from './MarkdownEditor.js';

export interface MarkdownEditorPlugin {
    /** Stable plugin name (diagnostics; trigger sessions report it). */
    name: string;
    inline?: InlinePluginSpec;
    trigger?: TriggerSpec;
    /** Extra toolbar items, appended after the editor's base item set. */
    toolbar?: ToolbarItem[];
}

export interface InlinePluginSpec {
    /** The parser extension that recognizes this construct in markdown source. */
    syntax: ParserInlineExtension;
    /**
     * Preview renderer (the `components.extension[syntax.name]` slot). Optional —
     * without it, `MarkdownView` falls back to the node's `raw` source as text.
     */
    component?: (props: ExtensionProps) => MarkdownChild;
    /**
     * doc → markdown: serialize one plugin-owned span back to markdown source.
     * Receives the span and the text it covers in the editor field. Emitted
     * atomically in place of the covered text (e.g. a mention span covering
     * `Andy` serializes to `@[Andy](u1)`).
     */
    serialize(span: InlineSpan, text: string): string;
    /** The AST ↔ editor-span bridge for the editable field. */
    docMapping: {
        /**
         * The span type this plugin owns in the editor document. Must be one of
         * the codec-allowed {@link InlineSpan} types (`mention` is reserved for
         * exactly this) — unknown types are dropped by the native codec.
         */
        spanType: InlineSpan['type'];
        /**
         * markdown → doc: map a parsed extension node to the text the field
         * should display plus the span carrying its data. Return `null` to keep
         * the surrounding block as a raw (source-edited) block instead.
         */
        toSpan(node: InlineExtension): { text: string; span: Omit<InlineSpan, 'start' | 'end'> } | null;
    };
}

/** One entry in a trigger session's result list. */
export interface TriggerItem {
    id: string;
    label: string;
    [key: string]: unknown;
}

export interface TriggerSpec {
    /** Single trigger character (`'@'`). Exactly one of `char`/`pattern`. */
    char?: string;
    /**
     * Multi-char trigger: matched against the run of non-whitespace text
     * between the last boundary and the caret; must match at its start
     * (e.g. `/^::/`). The match length is the trigger length; what follows is
     * the query.
     */
    pattern?: RegExp;
    /** Debounce between `onQuery` calls in ms. `0`/omitted = immediate. */
    debounce?: number;
    /**
     * Resolve suggestions for the current query (the text typed after the
     * trigger). May be async — stale results (a newer query has since been
     * issued, or the session closed) are discarded.
     */
    onQuery(query: string): TriggerItem[] | Promise<TriggerItem[]>;
    /** Re-skin a suggestion row (the popup's neutral default renders `label`). */
    renderItem?(item: TriggerItem, active: boolean): JSXElement;
    /** A suggestion was picked. Typically calls `api.replaceQuery(...)`. */
    onSelect(item: TriggerItem, api: TriggerSelectApi): void;
}

/** What `onSelect` receives to act on the editor. */
export interface TriggerSelectApi {
    /**
     * Replace the whole trigger run (trigger char/prefix + query) with `text`,
     * leaving the caret after it.
     */
    replaceQuery(text: string): void;
    /** The `[start, end)` range of the trigger run in the document text. */
    range: { start: number; end: number };
    controller: MarkdownEditorController;
}
