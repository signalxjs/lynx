/**
 * AST node types for the SignalX-native markdown renderer.
 *
 * The tree is intentionally small and flat: the parser produces it, the render
 * layer maps it to Lynx `<view>`/`<text>`/`<image>` intrinsics, and the
 * incremental engine memoizes finalized {@link BlockNode}s by reference. Every
 * block carries a `key` (assigned by the incremental layer for stable
 * reconciliation) and `raw` (the exact source slice, used for memo equality and
 * introspection).
 */

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export type InlineNode =
    | InlineText
    | InlineStrong
    | InlineEm
    | InlineDel
    | InlineCodeSpan
    | InlineLink
    | InlineImage
    | InlineAutolink
    | InlineBreak;

/** A run of literal text. */
export interface InlineText {
    type: 'text';
    value: string;
}

/** `**bold**` / `__bold__`. */
export interface InlineStrong {
    type: 'strong';
    children: InlineNode[];
}

/** `*italic*` / `_italic_`. */
export interface InlineEm {
    type: 'em';
    children: InlineNode[];
}

/** GFM `~~strikethrough~~`. */
export interface InlineDel {
    type: 'del';
    children: InlineNode[];
}

/** `` `code` `` — content is literal (no nested inline parsing). */
export interface InlineCodeSpan {
    type: 'codeSpan';
    value: string;
}

/** `[text](href "title")`. */
export interface InlineLink {
    type: 'link';
    href: string;
    title?: string;
    children: InlineNode[];
}

/** `![alt](src "title")`. */
export interface InlineImage {
    type: 'image';
    src: string;
    alt: string;
    title?: string;
}

/** `<https://…>` / `<email>` / GFM bare-URL autolink. */
export interface InlineAutolink {
    type: 'autolink';
    href: string;
    value: string;
}

/** A hard line break (two trailing spaces or a trailing backslash). */
export interface InlineBreak {
    type: 'br';
}

// ---------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------

export interface BlockBase {
    /** Stable reconciliation key, assigned by the incremental engine. */
    key: string;
    /** Exact source slice this block was parsed from. */
    raw: string;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TableAlign = 'left' | 'center' | 'right';

export type BlockNode =
    | HeadingBlock
    | ParagraphBlock
    | BlockquoteBlock
    | ListBlock
    | CodeBlock
    | ThematicBreakBlock
    | TableBlock;

export interface HeadingBlock extends BlockBase {
    type: 'heading';
    level: HeadingLevel;
    children: InlineNode[];
}

export interface ParagraphBlock extends BlockBase {
    type: 'paragraph';
    children: InlineNode[];
}

export interface BlockquoteBlock extends BlockBase {
    type: 'blockquote';
    children: BlockNode[];
}

export interface ListBlock extends BlockBase {
    type: 'list';
    ordered: boolean;
    /** Starting number for ordered lists (1 for unordered). */
    start: number;
    /** Tight lists have no blank lines between items → tighter spacing. */
    tight: boolean;
    items: ListItem[];
}

export interface ListItem {
    key: string;
    /** GFM task list state: `true`/`false`, or `null` when not a task item. */
    checked: boolean | null;
    children: BlockNode[];
}

export interface CodeBlock extends BlockBase {
    type: 'codeBlock';
    lang?: string;
    value: string;
    /** `false` while the fence is still open (streaming, or unterminated). */
    closed: boolean;
}

export interface ThematicBreakBlock extends BlockBase {
    type: 'thematicBreak';
}

export interface TableBlock extends BlockBase {
    type: 'table';
    /** Per-column alignment; `null` = default (left). */
    align: (TableAlign | null)[];
    header: TableCell[];
    rows: TableCell[][];
}

export interface TableCell {
    children: InlineNode[];
}
