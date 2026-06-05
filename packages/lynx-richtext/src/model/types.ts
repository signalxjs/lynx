/**
 * The rich document model — the single data shape that crosses the JS↔native
 * bridge for `<sigx-richtext>`.
 *
 * Design invariants (load-bearing — native code on both platforms relies on
 * them):
 *
 * - **Flat text + ranges, not a tree.** `NSAttributedString` (iOS) and
 *   `Spannable` (Android) are natively a flat string with attribute ranges, so
 *   this model maps 1:1 onto the platform primitives with no tree walking.
 * - **UTF-16 code-unit offsets everywhere.** JS strings, `NSRange`, and
 *   Android `CharSequence` all index by UTF-16 code units, so no index
 *   translation happens at any boundary. (Surrogate pairs — emoji — count
 *   as 2; producers must never split one.)
 * - **`blocks` ranges align to line boundaries** (`\n`-separated). Producers
 *   normalize; native re-snaps defensively.
 * - **Native never parses markdown.** Markdown ↔ RichDoc conversion lives in
 *   `@sigx/lynx-markdown`; this package is markdown-agnostic.
 * - **`v` is a monotonic version.** Every native-side user edit bumps it;
 *   `setDocument` carries the version the write was based on so native can
 *   drop stale writes (see the IME/echo rules in the package README).
 */

/**
 * Inline character-range formats. `link` carries `attrs.href`.
 *
 * `mention` is an atomic chip: the span covers **exactly one U+FFFC code
 * unit** and the visible label lives only in `attrs.label` (with `attrs.id`,
 * optional `attrs.kind`). Native draws the pill via NSTextAttachment (iOS) /
 * ReplacementSpan (Android); serializers must read attrs, never the covered
 * text. Copying a chip degrades to a bare U+FFFC in plain text (v1).
 */
export type InlineSpanType = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'mention';

export interface InlineSpan {
    /** Inclusive start, UTF-16 code units. */
    start: number;
    /** Exclusive end, UTF-16 code units. */
    end: number;
    type: InlineSpanType;
    /** Type-specific payload (`href` for links, `id`/`label` for mentions). */
    attrs?: Record<string, string>;
}

/**
 * Paragraph-level block types. MVP renders `paragraph` + `heading`; the rest
 * are reserved (P2/P3). `raw` is a consumer escape hatch (e.g. lynx-markdown
 * keeps unmodeled markdown source verbatim in a raw block) — native renders it
 * as a plain paragraph and round-trips the attr untouched.
 */
export type BlockAttrType =
    | 'paragraph'
    | 'heading'
    | 'bullet'
    | 'ordered'
    | 'task'
    | 'blockquote'
    | 'codeBlock'
    | 'raw';

export interface BlockAttr {
    /** Inclusive start of the paragraph's char range (line boundary). */
    start: number;
    /** Exclusive end (line boundary / end of text). */
    end: number;
    type: BlockAttrType;
    /** Heading level 1–6 (heading only). */
    level?: number;
    /** Task checkbox state (task only). */
    checked?: boolean;
}

export interface RichDoc {
    text: string;
    spans: InlineSpan[];
    blocks: BlockAttr[];
    /** Monotonic document version (see module docs). */
    v: number;
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/** `bindchange` — fired after every user edit (and after applied programmatic mutations). */
export interface RichTextChangeEvent {
    type: 'change';
    detail: {
        /** JSON-encoded {@link RichDoc} (decode with `decodeDoc`). */
        doc: string;
        /** True while an IME composition session is active — do NOT echo writes back. */
        isComposing: boolean;
    };
}

/** `bindselection` — caret/selection moved. Drives toolbar active state + popup anchoring. */
export interface RichTextSelectionEvent {
    type: 'selection';
    detail: {
        start: number;
        end: number;
        /** Comma-separated inline formats covering the selection (or the typing attributes when collapsed), e.g. `"bold,italic"`. */
        activeFormats: string;
        /** Block type of the caret's paragraph. */
        activeBlock: string;
        /** Heading level when `activeBlock === 'heading'`. */
        headingLevel?: number;
        /** Caret rectangle in the element's own coordinate space (popup anchoring). */
        caretX: number;
        caretY: number;
        caretHeight: number;
    };
}

/** `bindheightchange` — intrinsic content height changed (auto-grow). */
export interface RichTextHeightChangeEvent {
    type: 'heightchange';
    detail: {
        /** Content height in px (may exceed the clamped frame height). */
        height: number;
        /** Line count. */
        lines: number;
    };
}

export interface RichTextFocusEvent {
    type: 'focus' | 'blur';
    detail: Record<string, never>;
}

/** Parsed form of `bindselection`'s detail (after `activeFormats` is split). */
export interface SelectionState {
    start: number;
    end: number;
    activeFormats: InlineSpanType[];
    activeBlock: BlockAttrType;
    headingLevel?: number;
    caretRect: { x: number; y: number; height: number };
}
