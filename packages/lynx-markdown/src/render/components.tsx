/**
 * The render-function component contract and the neutral default renderers.
 *
 * `@sigx/lynx-markdown` is **generic**: the defaults here use only plain inline
 * styles (numbers + theme-agnostic colors) so the renderer works standalone on
 * any platform/theme with zero design-system coupling. A design system (e.g.
 * `@sigx/lynx-daisyui`) supplies its own {@link MarkdownComponents} to control
 * the look — see the `components` prop on `<Markdown>`.
 *
 * Each component receives its already-rendered `children` plus the raw AST
 * `node`; the engine owns AST recursion and stable streaming keys, so a
 * component only decides *what element to wrap children in*.
 */

import type { JSXElement } from '@sigx/lynx';
import type {
    BlockquoteBlock,
    CodeBlock,
    HeadingBlock,
    HeadingLevel,
    InlineAutolink,
    InlineCodeSpan,
    InlineDel,
    InlineEm,
    InlineExtension,
    InlineImage,
    InlineLink,
    InlineStrong,
    ListBlock,
    ListItem,
    ParagraphBlock,
    TableAlign,
    TableBlock,
    ThematicBreakBlock,
} from '../ast.js';

/** A renderable child: a JSX element or a raw string (for text/`<br>`). */
export type MarkdownChild = JSXElement | string;

// -- Per-component prop shapes ------------------------------------------------

export interface RootProps {
    children: MarkdownChild[];
}
export interface HeadingProps {
    level: HeadingLevel;
    children: MarkdownChild[];
    node: HeadingBlock;
}
export interface ParagraphProps {
    children: MarkdownChild[];
    node: ParagraphBlock;
}
export interface BlockquoteProps {
    children: MarkdownChild[];
    node: BlockquoteBlock;
}
export interface ListProps {
    ordered: boolean;
    start: number;
    tight: boolean;
    children: MarkdownChild[];
    node: ListBlock;
}
export interface ListItemProps {
    ordered: boolean;
    /** Zero-based index within the list. */
    index: number;
    /** Display number for ordered lists (`start + index`). */
    number: number;
    /** GFM task state, or `null` when not a task item. */
    checked: boolean | null;
    children: MarkdownChild[];
    item: ListItem;
}
export interface CodeProps {
    lang?: string;
    value: string;
    /** `false` while the fence is still streaming/unterminated. */
    closed: boolean;
    node: CodeBlock;
}
export interface ThematicBreakProps {
    node: ThematicBreakBlock;
}
export interface TableProps {
    align: (TableAlign | null)[];
    children: MarkdownChild[];
    node: TableBlock;
}
export interface TableRowProps {
    header: boolean;
    children: MarkdownChild[];
    node: TableBlock;
}
export interface TableCellProps {
    header: boolean;
    align: TableAlign | null;
    children: MarkdownChild[];
    node: TableBlock;
}

export interface StrongProps {
    children: MarkdownChild[];
    node: InlineStrong;
}
export interface EmProps {
    children: MarkdownChild[];
    node: InlineEm;
}
export interface DelProps {
    children: MarkdownChild[];
    node: InlineDel;
}
export interface CodeSpanProps {
    value: string;
    node: InlineCodeSpan;
}
export interface LinkProps {
    href: string;
    title?: string;
    children: MarkdownChild[];
    onLink?: (href: string) => void;
    node: InlineLink;
}
export interface AutolinkProps {
    href: string;
    value: string;
    onLink?: (href: string) => void;
    node: InlineAutolink;
}
export interface ImageProps {
    src: string;
    alt: string;
    title?: string;
    onImageTap?: (src: string) => void;
    node: InlineImage;
}
export interface ExtensionProps {
    name: string;
    attrs: Record<string, string>;
    /** Rendered `node.children`; `[]` for leaf extensions. */
    children: MarkdownChild[];
    node: InlineExtension;
}

/**
 * Map of node type → render function. Pass a partial map to `<Markdown
 * components={…}>` to override any subset; unspecified types fall back to the
 * neutral {@link defaultComponents}.
 */
export interface MarkdownComponents {
    root(props: RootProps): JSXElement;
    heading(props: HeadingProps): JSXElement;
    paragraph(props: ParagraphProps): JSXElement;
    blockquote(props: BlockquoteProps): JSXElement;
    list(props: ListProps): JSXElement;
    listItem(props: ListItemProps): JSXElement;
    code(props: CodeProps): JSXElement;
    thematicBreak(props: ThematicBreakProps): JSXElement;
    table(props: TableProps): JSXElement;
    tableRow(props: TableRowProps): JSXElement;
    tableCell(props: TableCellProps): JSXElement;
    strong(props: StrongProps): MarkdownChild;
    em(props: EmProps): MarkdownChild;
    del(props: DelProps): MarkdownChild;
    codeSpan(props: CodeSpanProps): MarkdownChild;
    link(props: LinkProps): MarkdownChild;
    autolink(props: AutolinkProps): MarkdownChild;
    image(props: ImageProps): MarkdownChild;
    br(): MarkdownChild;
    /**
     * Renderers for plugin inline extensions, keyed by extension name. A node
     * with no matching renderer falls back to its `raw` source as plain text.
     */
    extension?: Record<string, (props: ExtensionProps) => MarkdownChild>;
}

// -- Neutral, theme-agnostic defaults ----------------------------------------

/** Faint neutral fill that reads on both light and dark backgrounds. */
const SURFACE = 'rgba(127, 127, 127, 0.14)';
const BORDER = 'rgba(127, 127, 127, 0.32)';
const LINK = '#3478f6';

const HEADING_SIZE: Record<HeadingLevel, number> = { 1: 30, 2: 24, 3: 20, 4: 18, 5: 16, 6: 14 };

export const defaultComponents: MarkdownComponents = {
    root: ({ children }) => (
        <view style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</view>
    ),

    heading: ({ level, children }) => (
        <text
            style={{
                fontSize: HEADING_SIZE[level],
                fontWeight: level <= 2 ? 700 : 600,
                ...(level >= 6 ? { opacity: 0.8 } : {}),
            }}
        >
            {children}
        </text>
    ),

    paragraph: ({ children }) => <text style={{ fontSize: 16, lineHeight: 24 }}>{children}</text>,

    blockquote: ({ children }) => (
        <view
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                paddingLeft: 12,
                borderLeftWidth: 4,
                borderLeftStyle: 'solid',
                borderLeftColor: BORDER,
                opacity: 0.85,
            }}
        >
            {children}
        </view>
    ),

    list: ({ children }) => (
        <view style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</view>
    ),

    listItem: ({ ordered, number, checked, children }) => {
        const isBullet = checked === null && !ordered;
        return (
            <view style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                {isBullet ? (
                    // A real bullet is a drawn circle, not a glyph — exact size and
                    // vertical centering on the first text line (lineHeight 24 →
                    // center at 12, radius 3 → marginTop 9).
                    <view
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            marginTop: 9,
                            marginLeft: 2,
                            backgroundColor: 'rgba(120, 120, 120, 0.9)',
                        }}
                    />
                ) : checked !== null ? (
                    // A drawn checkbox (a real bordered box) instead of the ☑/☐ glyphs,
                    // which render inconsistently. Centered on the first line
                    // (16px box on a 24px line → marginTop 4).
                    <view
                        style={{
                            width: 16,
                            height: 16,
                            marginTop: 4,
                            borderRadius: 4,
                            borderWidth: 1.5,
                            borderStyle: 'solid',
                            borderColor: checked ? '#3478f6' : 'rgba(127, 127, 127, 0.6)',
                            backgroundColor: checked ? '#3478f6' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {checked ? (
                            <text style={{ color: '#ffffff', fontSize: 11, lineHeight: 12 }}>✓</text>
                        ) : null}
                    </view>
                ) : (
                    // Same size/lineHeight as the body paragraph so the number and
                    // the text share a baseline.
                    <text style={{ fontSize: 16, lineHeight: 24, opacity: 0.6 }}>
                        {`${number}.`}
                    </text>
                )}
                <view
                    style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, flexShrink: 1 }}
                >
                    {children}
                </view>
            </view>
        );
    },

    code: ({ lang, value }) => (
        <view
            style={{
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: SURFACE,
                borderRadius: 8,
                padding: 12,
            }}
        >
            {lang ? (
                <text style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
                    {lang}
                </text>
            ) : null}
            <text style={{ fontFamily: 'monospace', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                {value}
            </text>
        </view>
    ),

    thematicBreak: () => (
        <view style={{ height: 1, backgroundColor: BORDER, marginTop: 8, marginBottom: 8 }} />
    ),

    table: ({ children }) => (
        <view
            style={{
                display: 'flex',
                flexDirection: 'column',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: BORDER,
                borderRadius: 8,
                overflow: 'hidden',
            }}
        >
            {children}
        </view>
    ),

    tableRow: ({ header, children }) => (
        <view
            style={{
                display: 'flex',
                flexDirection: 'row',
                ...(header ? { backgroundColor: SURFACE } : {}),
            }}
        >
            {children}
        </view>
    ),

    tableCell: ({ header, align, children }) => (
        <view
            style={{
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 0,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 5,
                paddingBottom: 5,
                borderBottomWidth: 1,
                borderBottomStyle: 'solid',
                borderBottomColor: BORDER,
            }}
        >
            <text style={{ fontSize: 15, fontWeight: header ? 600 : 400, textAlign: align ?? 'left' }}>
                {children}
            </text>
        </view>
    ),

    strong: ({ children }) => <text style={{ fontWeight: 700 }}>{children}</text>,
    em: ({ children }) => <text style={{ fontStyle: 'italic' }}>{children}</text>,
    del: ({ children }) => (
        <text style={{ textDecoration: 'line-through', opacity: 0.8 }}>{children}</text>
    ),
    codeSpan: ({ value }) => (
        <text
            style={{
                fontFamily: 'monospace',
                fontSize: 14,
                backgroundColor: SURFACE,
                borderRadius: 4,
                paddingLeft: 3,
                paddingRight: 3,
            }}
        >
            {value}
        </text>
    ),
    link: ({ href, children, onLink }) => (
        <text style={{ color: LINK, textDecoration: 'underline' }} bindtap={() => onLink?.(href)}>
            {children}
        </text>
    ),
    autolink: ({ href, value, onLink }) => (
        <text style={{ color: LINK, textDecoration: 'underline' }} bindtap={() => onLink?.(href)}>
            {value}
        </text>
    ),
    image: ({ src, alt, onImageTap }) => (
        <text style={{ color: LINK, textDecoration: 'underline' }} bindtap={() => onImageTap?.(src)}>
            {alt || src}
        </text>
    ),
    br: () => '\n',
};
