/**
 * markdown → {@link RichDoc} — flatten the parsed AST into the rich-text
 * element's flat text+spans+blocks model.
 *
 * v1 models paragraphs, headings, and the inline set
 * (bold/italic/strike/code/link). Everything else — lists, blockquotes, code
 * blocks, tables, thematic breaks, and any paragraph containing an
 * unrepresentable inline (images) — becomes a **`raw` block**: the original
 * markdown source verbatim, edited as source and serialized back
 * byte-for-byte. That's the lossless escape hatch that makes the round trip
 * safe long before every node type is WYSIWYG-editable.
 *
 * Line convention (chat-style): every `\n` in `doc.text` is a paragraph
 * boundary. Markdown hard breaks split into separate doc lines; `docToMd`
 * serializes doc lines back as blank-line-separated paragraphs (hard breaks
 * normalize to paragraph breaks — documented).
 */

import type { BlockAttr, InlineSpan, RichDoc } from '@sigx/lynx-richtext';
import { parseBlocks } from '../../parser/blocks.js';
import type { ParserInlineExtension } from '../../parser/extensions.js';
import type { InlineExtension, InlineNode } from '../../ast.js';

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
                if (!mappers?.[node.name]?.(node)) return false;
                break;
            default:
                return false; // image, unmapped extension nodes
        }
    }
    return true;
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
                    const mapped = mappers?.[node.name]?.(node);
                    if (!mapped) break; // unreachable — filtered by inlineRepresentable
                    const start = base + text.length;
                    text += mapped.text;
                    spans.push({ start, end: base + text.length, ...mapped.span });
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
