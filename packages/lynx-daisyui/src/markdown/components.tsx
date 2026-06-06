/**
 * daisyUI rendering for `@sigx/lynx-markdown`.
 *
 * `@sigx/lynx-markdown` is design-system-agnostic: `<MarkdownView>` walks the
 * markdown AST and calls a {@link MarkdownComponents} render function per node
 * type. This module supplies the daisyUI mapping — headings → `<Heading>`, text
 * → `<Text>`, layout → `<Col>`/`<Row>`, themed surfaces/borders via daisyUI
 * utility classes — so markdown output matches the rest of the design system and
 * follows the active theme.
 *
 * The class literals live here in `@sigx/lynx-daisyui/src`, so the app's Tailwind
 * `content` glob (which already scans this package) generates them; and daisyUI's
 * `<Col>`/`<Row>` set `display:flex`, so layout is correct on Lynx.
 *
 * `@sigx/lynx-markdown` is an *optional* peer dependency — importing daisyUI
 * without it is fine; you just don't use `markdownComponents`.
 *
 * @example
 * ```tsx
 * import { MarkdownView } from '@sigx/lynx-markdown';
 * import { markdownComponents } from '@sigx/lynx-daisyui';
 *
 * <MarkdownView value={md} components={markdownComponents} onLink={open} />
 * ```
 */

import type { MarkdownComponents } from '@sigx/lynx-markdown';
import { Heading } from '../typography/Heading.js';
import { Text } from '../typography/Text.js';
import { Col, Row } from '@sigx/lynx-zero';

import { Divider } from '../layout/Divider.js';
import { Checkbox } from '../forms/Checkbox.js';

function alignClass(align: 'left' | 'center' | 'right' | null): string {
    return align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
}

export const markdownComponents: MarkdownComponents = {
    root: ({ children }) => <Col gap={12}>{children}</Col>,

    heading: ({ level, children }) => <Heading level={level}>{children}</Heading>,

    paragraph: ({ children }) => <Text class="leading-relaxed">{children}</Text>,

    blockquote: ({ children }) => (
        <Col gap={8} class="border-l-4 border-base-300 pl-4 opacity-80">
            {children}
        </Col>
    ),

    list: ({ children }) => <Col gap={4}>{children}</Col>,

    listItem: ({ ordered, number, checked, children }) => (
        <Row gap={6} align="flex-start">
            {checked !== null ? (
                <Checkbox checked={checked} size="sm" disabled class="mt-1" />
            ) : ordered ? (
                // Same <Text> as the body paragraph (base size + leading-relaxed) so
                // the number and the text share a baseline.
                <Text class="opacity-60 leading-relaxed">{`${number}.`}</Text>
            ) : (
                // A drawn circle, centered on the first line (leading-relaxed ≈ 27 →
                // center 13.5, radius 3 → marginTop 11). A muted neutral reads well on
                // any theme — and dodges Lynx's inability to parse oklch theme tokens
                // for a background fill.
                <view
                    style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        marginTop: 11,
                        backgroundColor: 'rgba(127, 127, 127, 0.9)',
                    }}
                />
            )}
            <Col gap={4} class="flex-1">
                {children}
            </Col>
        </Row>
    ),

    code: ({ lang, value }) => (
        <Col gap={4} background="base-200" borderRadius={8} padding={12}>
            {lang ? <Text size="xs" class="opacity-60 font-mono">{lang}</Text> : null}
            <Text size="sm" class="font-mono whitespace-pre-wrap">
                {value}
            </Text>
        </Col>
    ),

    thematicBreak: () => <Divider />,

    table: ({ children }) => (
        <Col class="border border-base-300 rounded-lg overflow-hidden">{children}</Col>
    ),

    tableRow: ({ header, children }) => (
        <Row class={header ? 'bg-base-200' : ''}>{children}</Row>
    ),

    tableCell: ({ header, align, children }) => (
        <view class="flex-1 px-2 py-1 border-b border-base-300">
            <Text size="sm" weight={header ? 'semibold' : 'normal'} class={alignClass(align)}>
                {children}
            </Text>
        </view>
    ),

    strong: ({ children }) => <text class="font-bold">{children}</text>,
    em: ({ children }) => <text class="italic">{children}</text>,
    del: ({ children }) => <text class="line-through opacity-80">{children}</text>,
    codeSpan: ({ value }) => <text class="font-mono text-sm bg-base-200 rounded px-1">{value}</text>,
    link: ({ href, children, onLink }) => (
        <text class="text-primary underline" bindtap={() => onLink?.(href)}>
            {children}
        </text>
    ),
    autolink: ({ href, value, onLink }) => (
        <text class="text-primary underline" bindtap={() => onLink?.(href)}>
            {value}
        </text>
    ),
    image: ({ src, alt, onImageTap }) => (
        <text class="text-primary underline" bindtap={() => onImageTap?.(src)}>
            {alt || src}
        </text>
    ),
    br: () => '\n',
};
