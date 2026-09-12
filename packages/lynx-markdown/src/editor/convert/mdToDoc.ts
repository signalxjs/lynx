/**
 * markdown → {@link RichDoc} — flatten the parsed mdast tree into the rich-text
 * element's flat text+spans+blocks model.
 *
 * Models paragraphs, headings, the inline set (bold/italic/strike/code/link),
 * and — flat, one block attr per line, markers **never in the text** (they're
 * draw-only natively and re-synthesized by `docToMd`):
 *
 * - **tight single-paragraph lists** → one `bullet`/`ordered`/`task` line per
 *   item (`checked` from GFM task syntax; a non-1 ordered start rides
 *   `level` on the run's first line);
 * - **blockquotes of plain paragraphs** → one `blockquote` line per quoted
 *   line;
 * - **fenced code** → one `codeBlock` line per content line (`lang` carried
 *   on every line of the fence).
 *
 * Everything the flat model cannot hold losslessly — nested / loose /
 * multi-paragraph lists, quotes containing non-paragraphs, tables, thematic
 * breaks, raw HTML, link reference definitions, and any paragraph containing
 * an unrepresentable inline (images, reference links) — becomes a **`raw`
 * block**: the original markdown source verbatim (`sliceSource` over the
 * node's `position`), edited as source and serialized back byte-for-byte.
 * That's the lossless escape hatch that keeps the round trip safe.
 *
 * Line convention (chat-style): every `\n` in `doc.text` is a paragraph
 * boundary. Markdown hard breaks split into separate doc lines; soft breaks
 * (kept as `\n` inside mdast `text` values) join with a space; `docToMd`
 * serializes doc lines back as blank-line-separated paragraphs (hard breaks
 * normalize to paragraph breaks — documented).
 */

import type { BlockAttr, InlineSpan, RichDoc } from '@sigx/lynx-richtext';
import {
    normalizeSource,
    parseMarkdown,
    sanitizeUrl,
    sliceSource,
    toPlainText,
    type Blockquote,
    type List,
    type MarkdownPlugin,
    type Node,
    type Paragraph,
    type PhrasingContent,
} from '@sigx/markdown';

/** Plugin node → editor span (a plugin's `docMapping.toSpan`). Must be pure. */
export type PluginSpanMapper<N extends Node = Node> = (
    node: N,
) => { text: string; span: Omit<InlineSpan, 'start' | 'end'> } | null;

/** Span mappers keyed by the plugin node `type` they handle. */
export type PluginSpanMappers = Record<string, PluginSpanMapper<any>>;

export interface MdToDocOptions {
    /** `@sigx/markdown` plugins to parse with (the editor plugins' `inline.syntax`, wrapped). */
    plugins?: readonly MarkdownPlugin[];
    /** Span mappers keyed by plugin node type (plugin `docMapping.toSpan`). */
    spanMappers?: PluginSpanMappers;
}

export function mdToDoc(markdown: string, v = 0, options?: MdToDocOptions): RichDoc {
    // Positions index the line-ending-normalised source — slice raw blocks
    // from the same string the parser saw.
    const source = normalizeSource(markdown ?? '');
    const ast = parseMarkdown(source, options?.plugins ? { plugins: options.plugins } : undefined);
    const mappers = options?.spanMappers;
    /** The exact source of a node — the `raw` block content and the plugin fallback text. */
    const raw = (node: Node): string => sliceSource(source, node) ?? '';

    let text = '';
    const spans: InlineSpan[] = [];
    const blocks: BlockAttr[] = [];

    /** Append one doc line (or multi-line raw chunk) plus its block attr. */
    const push = (chunk: string, attr?: Omit<BlockAttr, 'start' | 'end'>): void => {
        // Raw chunks may carry trailing blank lines — the inter-block
        // separator is reconstructed by the serializer's join, so strip them
        // here for stable round trips.
        if (attr?.type === 'raw') chunk = chunk.replace(/\n+$/, '');
        const start = text.length;
        text += chunk;
        if (attr) {
            // Range includes the trailing newline once it exists — matching how
            // native paragraph ranges read back (paragraphRange semantics).
            blocks.push({ start, end: text.length + 1, ...attr });
        }
        text += '\n';
    };

    for (const block of ast.children) {
        switch (block.type) {
            case 'paragraph': {
                if (!inlineRepresentable(block.children, mappers)) {
                    push(raw(block), { type: 'raw' });
                    break;
                }
                for (const line of splitOnBreaks(block.children)) {
                    const flat = flattenInline(line, text.length, mappers, raw);
                    spans.push(...flat.spans);
                    push(flat.text);
                }
                break;
            }
            case 'heading': {
                if (!inlineRepresentable(block.children, mappers)) {
                    push(raw(block), { type: 'raw' });
                    break;
                }
                const flat = flattenInline(block.children, text.length, mappers, raw);
                spans.push(...flat.spans);
                push(flat.text, { type: 'heading', level: block.depth });
                break;
            }
            case 'list': {
                if (!isFlatList(block, mappers)) {
                    push(raw(block), { type: 'raw' });
                    break;
                }
                const ordered = block.ordered === true;
                const start = block.start ?? 1;
                block.children.forEach((item, index) => {
                    const para = item.children[0] as Paragraph;
                    const flat = flattenInline(para.children, text.length, mappers, raw);
                    spans.push(...flat.spans);
                    const checked = item.checked ?? null;
                    const attr: Omit<BlockAttr, 'start' | 'end'> =
                        checked !== null
                            ? { type: 'task', checked }
                            : { type: ordered ? 'ordered' : 'bullet' };
                    // A non-1 ordered start rides `level` on the run's first
                    // line; numbering itself derives from position.
                    if (index === 0 && ordered && start !== 1 && attr.type === 'ordered') {
                        attr.level = start;
                    }
                    push(flat.text, attr);
                });
                break;
            }
            case 'blockquote': {
                if (!isFlatQuote(block, mappers)) {
                    push(raw(block), { type: 'raw' });
                    break;
                }
                for (const child of block.children) {
                    for (const line of splitOnBreaks((child as Paragraph).children)) {
                        const flat = flattenInline(line, text.length, mappers, raw);
                        spans.push(...flat.spans);
                        push(flat.text, { type: 'blockquote' });
                    }
                }
                break;
            }
            case 'code': {
                // An empty fence would model as a zero-length block attr,
                // which native can't persist (an empty paragraph can't hold
                // one) — keep the source raw instead.
                if (block.value === '') {
                    push(raw(block), { type: 'raw' });
                    break;
                }
                // Content is literal — one codeBlock line per content line
                // (blank lines included), no inline parsing, `lang` on every
                // line of the fence so adjacent fences with different langs
                // stay distinct runs.
                const attr: Omit<BlockAttr, 'start' | 'end'> = block.lang
                    ? { type: 'codeBlock', lang: block.lang }
                    : { type: 'codeBlock' };
                for (const line of block.value.split('\n')) {
                    push(line, attr);
                }
                break;
            }
            default:
                // thematicBreak, table, html, definition, plugin blocks.
                push(raw(block), { type: 'raw' });
        }
    }

    // Drop the final separator newline; clamp any block range that reached
    // past it (the "+1 for trailing newline" of the last block).
    if (text.endsWith('\n')) text = text.slice(0, -1);
    for (const b of blocks) {
        if (b.end > text.length) b.end = text.length;
    }

    return { text, spans, blocks, v };
}

/**
 * A list the flat model can hold losslessly: tight, every item a single
 * paragraph of representable inline with no top-level hard break. Nesting
 * shows up as an extra child block, loose lists as `spread: true`, and a
 * hard break would have to degrade to a space (items are single lines, so
 * unlike paragraphs/quotes there's no line to split it into) — all raw.
 */
function isFlatList(list: List, mappers?: PluginSpanMappers): boolean {
    return (
        !list.spread &&
        list.children.every(
            (item) =>
                !item.spread &&
                item.children.length === 1 &&
                item.children[0].type === 'paragraph' &&
                !item.children[0].children.some((node) => node.type === 'break') &&
                inlineRepresentable(item.children[0].children, mappers),
        )
    );
}

/**
 * A blockquote the flat model can hold losslessly: only plain paragraphs of
 * representable inline (a quote containing a list / heading / code / nested
 * quote degrades to raw, as does an empty quote — it would model as no
 * lines at all and lose its source).
 */
function isFlatQuote(quote: Blockquote, mappers?: PluginSpanMappers): boolean {
    return (
        quote.children.length > 0 &&
        quote.children.every(
            (child) => child.type === 'paragraph' && inlineRepresentable(child.children, mappers),
        )
    );
}

/** Inline node types the editor can model in-field. */
function inlineRepresentable(nodes: PhrasingContent[], mappers?: PluginSpanMappers): boolean {
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
            case 'break':
            case 'inlineCode':
                break;
            case 'strong':
            case 'emphasis':
            case 'delete':
            case 'link':
                if (!inlineRepresentable(node.children, mappers)) return false;
                break;
            case 'image':
            case 'linkReference':
            case 'imageReference':
                return false;
            default:
                // A plugin node — representable only when a plugin maps it to
                // an editor span (toSpan is pure, so probing here and mapping
                // later agree). A throwing mapper means "not representable" —
                // the block degrades to raw instead of crashing the conversion.
                if (!tryMap(mappers, node)) return false;
                break;
        }
    }
    return true;
}

/** Run a plugin mapper defensively: a throwing mapper counts as no mapping. */
function tryMap(mappers: PluginSpanMappers | undefined, node: Node): ReturnType<PluginSpanMapper> {
    try {
        return mappers?.[node.type]?.(node) ?? null;
    } catch {
        return null;
    }
}

/** Split a paragraph's inline children into visual lines at top-level hard breaks. */
function splitOnBreaks(nodes: PhrasingContent[]): PhrasingContent[][] {
    const lines: PhrasingContent[][] = [];
    let current: PhrasingContent[] = [];
    for (const node of nodes) {
        if (node.type === 'break') {
            lines.push(current);
            current = [];
        } else {
            current.push(node);
        }
    }
    lines.push(current);
    return lines;
}

interface Flat {
    text: string;
    spans: InlineSpan[];
}

/** Depth-first flatten of an inline tree into text + overlapping spans. */
function flattenInline(
    nodes: PhrasingContent[],
    base: number,
    mappers: PluginSpanMappers | undefined,
    raw: (node: Node) => string,
): Flat {
    let text = '';
    const spans: InlineSpan[] = [];

    const walk = (list: PhrasingContent[]): void => {
        for (const node of list) {
            switch (node.type) {
                case 'text':
                    // A soft line break stays `\n` in mdast text; in the doc
                    // model `\n` is a paragraph boundary, so it joins as a
                    // space (the CommonMark rendering of a soft break).
                    text += node.value.replace(/\n/g, ' ');
                    break;
                case 'break':
                    // Nested hard break (inside emphasis) — degrade to a space.
                    text += ' ';
                    break;
                case 'inlineCode': {
                    const start = base + text.length;
                    text += node.value;
                    spans.push({ start, end: base + text.length, type: 'code' });
                    break;
                }
                case 'strong': {
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({ start, end: base + text.length, type: 'bold' });
                    break;
                }
                case 'emphasis': {
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({ start, end: base + text.length, type: 'italic' });
                    break;
                }
                case 'delete': {
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({ start, end: base + text.length, type: 'strike' });
                    break;
                }
                case 'link': {
                    // Autolinks are `link` nodes whose children are the URL
                    // text. The href is sanitised here (the parser no longer
                    // does it) so the field never carries a live `javascript:`
                    // destination.
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({
                        start,
                        end: base + text.length,
                        type: 'link',
                        attrs: { href: sanitizeUrl(node.url, 'link') },
                    });
                    break;
                }
                case 'image':
                case 'linkReference':
                case 'imageReference':
                    break; // unreachable — filtered by inlineRepresentable
                default: {
                    const mapped = tryMap(mappers, node);
                    if (!mapped) {
                        // Defense in depth: if the mapper disagrees with the
                        // earlier representability probe (impure/buggy), keep
                        // the source text rather than silently dropping it.
                        text += raw(node) || toPlainText([node]);
                        break;
                    }
                    const start = base + text.length;
                    text += mapped.text;
                    // Plugin fields first — the converter always controls the
                    // final range, even if a mapper sneaks in start/end.
                    spans.push({ ...mapped.span, start, end: base + text.length });
                    break;
                }
            }
        }
    };

    walk(nodes);
    // Zero-length spans (empty emphasis) carry no information — drop them.
    return { text, spans: spans.filter((s) => s.end > s.start) };
}
