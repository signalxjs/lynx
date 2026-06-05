/**
 * markdown → {@link RichDoc} — flatten the parsed AST into the rich-text
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
 * breaks, and any paragraph containing an unrepresentable inline (images) —
 * becomes a **`raw` block**: the original markdown source verbatim, edited as
 * source and serialized back byte-for-byte. That's the lossless escape hatch
 * that keeps the round trip safe.
 *
 * Line convention (chat-style): every `\n` in `doc.text` is a paragraph
 * boundary. Markdown hard breaks split into separate doc lines; `docToMd`
 * serializes doc lines back as blank-line-separated paragraphs (hard breaks
 * normalize to paragraph breaks — documented).
 */

import type { BlockAttr, InlineSpan, RichDoc } from '@sigx/lynx-richtext';
import { parseBlocks } from '../../parser/blocks.js';
import type { ParserInlineExtension } from '../../parser/extensions.js';
import type { BlockquoteBlock, InlineExtension, InlineNode, ListBlock, ParagraphBlock } from '../../ast.js';

/** AST extension node → editor span (a plugin's `docMapping.toSpan`). Must be pure. */
export type ExtensionSpanMapper = (
    node: InlineExtension,
) => { text: string; span: Omit<InlineSpan, 'start' | 'end'> } | null;

export interface MdToDocOptions {
    /** Inline extensions to parse with (plugin `inline.syntax`). */
    extensions?: readonly ParserInlineExtension[];
    /** Span mappers keyed by extension name (plugin `docMapping.toSpan`). */
    spanMappers?: Record<string, ExtensionSpanMapper>;
}

export function mdToDoc(markdown: string, v = 0, options?: MdToDocOptions): RichDoc {
    const ast = parseBlocks(markdown ?? '', undefined, options?.extensions);
    const mappers = options?.spanMappers;

    let text = '';
    const spans: InlineSpan[] = [];
    const blocks: BlockAttr[] = [];

    /** Append one doc line (or multi-line raw chunk) plus its block attr. */
    const push = (chunk: string, attr?: Omit<BlockAttr, 'start' | 'end'>): void => {
        // Raw chunks may carry trailing blank lines consumed by the block
        // parser (loose lists) — the inter-block separator is reconstructed
        // by the serializer's join, so strip them here for stable round trips.
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

    for (const block of ast) {
        switch (block.type) {
            case 'paragraph': {
                if (!inlineRepresentable(block.children, mappers)) {
                    push(block.raw, { type: 'raw' });
                    break;
                }
                for (const line of splitOnBreaks(block.children)) {
                    const flat = flattenInline(line, text.length, mappers);
                    spans.push(...flat.spans);
                    push(flat.text);
                }
                break;
            }
            case 'heading': {
                if (!inlineRepresentable(block.children, mappers)) {
                    push(block.raw, { type: 'raw' });
                    break;
                }
                const flat = flattenInline(block.children, text.length, mappers);
                spans.push(...flat.spans);
                push(flat.text, { type: 'heading', level: block.level });
                break;
            }
            case 'list': {
                if (!isFlatList(block, mappers)) {
                    push(block.raw, { type: 'raw' });
                    break;
                }
                block.items.forEach((item, index) => {
                    const para = item.children[0] as ParagraphBlock;
                    const flat = flattenInline(para.children, text.length, mappers);
                    spans.push(...flat.spans);
                    const attr: Omit<BlockAttr, 'start' | 'end'> =
                        item.checked !== null
                            ? { type: 'task', checked: item.checked }
                            : { type: block.ordered ? 'ordered' : 'bullet' };
                    // A non-1 ordered start rides `level` on the run's first
                    // line; numbering itself derives from position.
                    if (index === 0 && block.ordered && block.start !== 1 && attr.type === 'ordered') {
                        attr.level = block.start;
                    }
                    push(flat.text, attr);
                });
                break;
            }
            case 'blockquote': {
                if (!isFlatQuote(block, mappers)) {
                    push(block.raw, { type: 'raw' });
                    break;
                }
                for (const child of block.children) {
                    for (const line of splitOnBreaks((child as ParagraphBlock).children)) {
                        const flat = flattenInline(line, text.length, mappers);
                        spans.push(...flat.spans);
                        push(flat.text, { type: 'blockquote' });
                    }
                }
                break;
            }
            case 'codeBlock': {
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
                push(block.raw, { type: 'raw' });
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
 * shows up as an extra child block, loose lists as `tight: false`, and a
 * hard break would have to degrade to a space (items are single lines, so
 * unlike paragraphs/quotes there's no line to split it into) — all raw.
 */
function isFlatList(list: ListBlock, mappers?: Record<string, ExtensionSpanMapper>): boolean {
    return (
        list.tight &&
        list.items.every(
            (item) =>
                item.children.length === 1 &&
                item.children[0].type === 'paragraph' &&
                !item.children[0].children.some((node) => node.type === 'br') &&
                inlineRepresentable(item.children[0].children, mappers),
        )
    );
}

/**
 * A blockquote the flat model can hold losslessly: only plain paragraphs of
 * representable inline (a quote containing a list / heading / code / nested
 * quote degrades to raw).
 */
function isFlatQuote(quote: BlockquoteBlock, mappers?: Record<string, ExtensionSpanMapper>): boolean {
    return quote.children.every(
        (child) => child.type === 'paragraph' && inlineRepresentable(child.children, mappers),
    );
}

/** Inline node types the editor can model in-field. */
function inlineRepresentable(nodes: InlineNode[], mappers?: Record<string, ExtensionSpanMapper>): boolean {
    for (const node of nodes) {
        switch (node.type) {
            case 'text':
            case 'br':
            case 'codeSpan':
            case 'autolink':
                break;
            case 'strong':
            case 'em':
            case 'del':
                if (!inlineRepresentable(node.children, mappers)) return false;
                break;
            case 'link':
                if (!inlineRepresentable(node.children, mappers)) return false;
                break;
            case 'extension':
                // Representable only when a plugin maps it to an editor span
                // (toSpan is pure, so probing here and mapping later agree).
                // A throwing mapper means "not representable" — the block
                // degrades to raw instead of crashing the conversion.
                if (!tryMap(mappers, node)) return false;
                break;
            default:
                return false; // image, unmapped extension nodes
        }
    }
    return true;
}

/** Run a plugin mapper defensively: a throwing mapper counts as no mapping. */
function tryMap(
    mappers: Record<string, ExtensionSpanMapper> | undefined,
    node: InlineExtension,
): ReturnType<ExtensionSpanMapper> {
    try {
        return mappers?.[node.name]?.(node) ?? null;
    } catch {
        return null;
    }
}

/** Split a paragraph's inline children into visual lines at top-level hard breaks. */
function splitOnBreaks(nodes: InlineNode[]): InlineNode[][] {
    const lines: InlineNode[][] = [];
    let current: InlineNode[] = [];
    for (const node of nodes) {
        if (node.type === 'br') {
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
    nodes: InlineNode[],
    base: number,
    mappers?: Record<string, ExtensionSpanMapper>,
): Flat {
    let text = '';
    const spans: InlineSpan[] = [];

    const walk = (list: InlineNode[]): void => {
        for (const node of list) {
            switch (node.type) {
                case 'text':
                    text += node.value;
                    break;
                case 'br':
                    // Nested hard break (inside emphasis) — degrade to a space.
                    text += ' ';
                    break;
                case 'codeSpan': {
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
                case 'em': {
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({ start, end: base + text.length, type: 'italic' });
                    break;
                }
                case 'del': {
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({ start, end: base + text.length, type: 'strike' });
                    break;
                }
                case 'link': {
                    const start = base + text.length;
                    walk(node.children);
                    spans.push({
                        start,
                        end: base + text.length,
                        type: 'link',
                        attrs: { href: node.href },
                    });
                    break;
                }
                case 'autolink': {
                    const start = base + text.length;
                    text += node.value;
                    spans.push({
                        start,
                        end: base + text.length,
                        type: 'link',
                        attrs: { href: node.href },
                    });
                    break;
                }
                case 'extension': {
                    const mapped = tryMap(mappers, node);
                    if (!mapped) {
                        // Defense in depth: if the mapper disagrees with the
                        // earlier representability probe (impure/buggy), keep
                        // the source text rather than silently dropping it.
                        text += node.raw;
                        break;
                    }
                    const start = base + text.length;
                    text += mapped.text;
                    // Plugin fields first — the converter always controls the
                    // final range, even if a mapper sneaks in start/end.
                    spans.push({ ...mapped.span, start, end: base + text.length });
                    break;
                }
                default:
                    break; // unreachable — filtered by inlineRepresentable
            }
        }
    };

    walk(nodes);
    // Zero-length spans (empty emphasis) carry no information — drop them.
    return { text, spans: spans.filter((s) => s.end > s.start) };
}
