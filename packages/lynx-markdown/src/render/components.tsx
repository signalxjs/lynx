/**
 * The neutral default renderers for Lynx — one `@sigx/richtext`
 * {@link ComponentMap} over Lynx `<view>`/`<text>` intrinsics.
 *
 * `@sigx/lynx-markdown` is **generic**: the defaults here use only plain inline
 * styles (numbers + theme-agnostic colors) so the renderer works standalone on
 * any platform/theme with zero design-system coupling. A design system (e.g.
 * `@sigx/lynx-daisyui`) supplies its own map to control the look — see the
 * `components` prop on `<MarkdownView>`.
 *
 * The slots are the mdast node types (`heading`, `emphasis`, `inlineCode`,
 * `break`, …) — the contract is `@sigx/richtext`'s `ComponentMap<E>` with
 * `E` = a Lynx `JSXElement` (only `root` is required; a slot the map lacks
 * renders the node's text projection or its children). Each component receives its already-rendered
 * `children` plus the AST `node`; the engine owns AST recursion and stable
 * streaming keys, so a component only decides *what element to wrap children
 * in*.
 */

import type { JSXElement } from '@sigx/lynx';
import type { ComponentMap, HeadingDepth, ImageProps, RenderChild } from '@sigx/richtext';

/** The Lynx component map: `@sigx/richtext`'s contract over Lynx elements. */
export type LynxMarkdownComponents = ComponentMap<JSXElement>;

/** A renderable child on Lynx: a JSX element or a raw string (text / `break`). */
export type LynxMarkdownChild = RenderChild<JSXElement>;

/**
 * What the Lynx `image` slot receives: the engine's {@link ImageProps} plus
 * `<MarkdownView>`'s `onImageTap` handler, threaded in by the view (the
 * platform-neutral engine knows nothing about image taps).
 */
export interface LynxImageProps extends ImageProps {
    onImageTap?: (url: string) => void;
}

// -- Neutral, theme-agnostic defaults ----------------------------------------

/** Faint neutral fill that reads on both light and dark backgrounds. */
const SURFACE = 'rgba(127, 127, 127, 0.14)';
const BORDER = 'rgba(127, 127, 127, 0.32)';
const LINK = '#3478f6';

const HEADING_SIZE: Record<HeadingDepth, number> = { 1: 30, 2: 24, 3: 20, 4: 18, 5: 16, 6: 14 };

/**
 * A soft line break is kept as `\n` inside `text.value` (mdast); Lynx `<text>`
 * would render it as a real line break, so paragraphs collapse it to a space —
 * the CommonMark rendering of a soft break.
 */
function collapseSoftBreaks(value: string): string {
    return value.includes('\n') ? value.replace(/\n/g, ' ') : value;
}

export const defaultComponents: LynxMarkdownComponents = {
    root: ({ children }) => (
        <view style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</view>
    ),

    heading: ({ depth, children }) => (
        <text
            style={{
                fontSize: HEADING_SIZE[depth],
                fontWeight: depth <= 2 ? 700 : 600,
                ...(depth >= 6 ? { opacity: 0.8 } : {}),
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

    // Raw HTML has no Lynx sink — it shows as literal text (an element, not a
    // bare string: a `<view>` cannot hold text directly).
    html: ({ value }) => <text style={{ fontSize: 16, lineHeight: 24 }}>{value}</text>,

    text: ({ value }) => collapseSoftBreaks(value),
    strong: ({ children }) => <text style={{ fontWeight: 700 }}>{children}</text>,
    emphasis: ({ children }) => <text style={{ fontStyle: 'italic' }}>{children}</text>,
    delete: ({ children }) => (
        <text style={{ textDecoration: 'line-through', opacity: 0.8 }}>{children}</text>
    ),
    inlineCode: ({ value }) => (
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
    link: ({ url, children, onLink, node }) => (
        <text style={{ color: LINK, textDecoration: 'underline' }} bindtap={() => onLink?.(url, node)}>
            {children}
        </text>
    ),
    image: ({ url, alt, onImageTap }: LynxImageProps) => (
        <text style={{ color: LINK, textDecoration: 'underline' }} bindtap={() => onImageTap?.(url)}>
            {alt || url}
        </text>
    ),
    break: () => '\n',
};
