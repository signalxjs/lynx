/**
 * Block-level parser: source → `BlockNode[]`.
 *
 * Line-oriented with a small open-container model. The key streaming-safety
 * rule lives here: a blank line only separates blocks at the top level and
 * *outside* an open fenced code block — a blank line inside ``` does not close
 * it. An unterminated fence parses as a `codeBlock` with `closed: false` and is
 * still rendered, so streaming code dumps don't flicker when the closing fence
 * finally arrives.
 *
 * Keys are assigned by the caller through a `KeyGen` so nested blocks (list
 * items, blockquote contents) get stable, unique keys for reconciliation.
 */

import type {
    BlockNode,
    HeadingLevel,
    ListItem,
    TableAlign,
    TableCell,
} from '../ast.js';
import { parseInline } from './inline.js';
import type { ParserInlineExtension } from './extensions.js';
import {
    indentOf,
    isBlank,
    isFenceClose,
    isThematicBreak,
    matchEmptyListMarker,
    matchFence,
    matchHeading,
    matchListMarker,
    matchTableDelimiter,
    splitTableRow,
    type ListMarkerInfo,
} from './scanner.js';

/** Monotonic key generator so every block (incl. nested) gets a unique key. */
export interface KeyGen {
    next(): string;
}

export function makeKeyGen(prefix: string): KeyGen {
    let n = 0;
    return { next: () => `${prefix}-${n++}` };
}

/** Parse a complete (or partial) source string into block nodes. */
export function parseBlocks(
    src: string,
    keys: KeyGen = makeKeyGen('b'),
    extensions?: readonly ParserInlineExtension[],
): BlockNode[] {
    const lines = src.split('\n');
    return parseLines(lines, keys, extensions);
}

function parseLines(
    lines: string[],
    keys: KeyGen,
    extensions?: readonly ParserInlineExtension[],
): BlockNode[] {
    const blocks: BlockNode[] = [];
    let i = 0;

    while (i < lines.length) {
        if (isBlank(lines[i])) {
            i++;
            continue;
        }

        const line = lines[i];

        // Fenced code block.
        const fence = matchFence(line);
        if (fence) {
            const start = i;
            const content: string[] = [];
            i++;
            let closed = false;
            while (i < lines.length) {
                if (isFenceClose(lines[i], fence)) {
                    closed = true;
                    i++;
                    break;
                }
                // Strip the fence's own indentation from content lines.
                content.push(stripIndent(lines[i], fence.indent));
                i++;
            }
            blocks.push({
                type: 'codeBlock',
                key: keys.next(),
                raw: lines.slice(start, i).join('\n'),
                ...(fence.info ? { lang: fence.info.split(/\s+/)[0] } : {}),
                value: content.join('\n'),
                closed,
            });
            continue;
        }

        // ATX heading.
        const heading = matchHeading(line);
        if (heading) {
            blocks.push({
                type: 'heading',
                key: keys.next(),
                raw: line,
                level: heading.level as HeadingLevel,
                children: parseInline(heading.text, extensions),
            });
            i++;
            continue;
        }

        // Thematic break (checked before list so `* * *` isn't a bullet).
        if (isThematicBreak(line)) {
            blocks.push({ type: 'thematicBreak', key: keys.next(), raw: line });
            i++;
            continue;
        }

        // Blockquote.
        if (/^ {0,3}>/.test(line)) {
            const start = i;
            const inner: string[] = [];
            while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
                inner.push(lines[i].replace(/^ {0,3}> ?/, ''));
                i++;
            }
            blocks.push({
                type: 'blockquote',
                key: keys.next(),
                raw: lines.slice(start, i).join('\n'),
                children: parseLines(inner, keys, extensions),
            });
            continue;
        }

        // List.
        const marker = matchListMarker(line) ?? matchEmptyListMarker(line);
        if (marker) {
            const result = parseList(lines, i, marker, keys, extensions);
            blocks.push(result.block);
            i = result.next;
            continue;
        }

        // GFM table: a header line whose successor is a delimiter row.
        if (line.indexOf('|') !== -1 && i + 1 < lines.length) {
            const align = matchTableDelimiter(lines[i + 1]);
            if (align) {
                const result = parseTable(lines, i, align, keys, extensions);
                blocks.push(result.block);
                i = result.next;
                continue;
            }
        }

        // Paragraph: consecutive non-blank lines until a block interrupts.
        const start = i;
        const para: string[] = [];
        while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines, i)) {
            para.push(lines[i]);
            i++;
        }
        blocks.push({
            type: 'paragraph',
            key: keys.next(),
            raw: lines.slice(start, i).join('\n'),
            children: parseInline(para.join('\n'), extensions),
        });
    }

    return blocks;
}

/** True when the line at `i` starts a block that interrupts a paragraph. */
function interrupts(lines: string[], i: number): boolean {
    const line = lines[i];
    if (matchFence(line)) return true;
    if (matchHeading(line)) return true;
    if (isThematicBreak(line)) return true;
    if (/^ {0,3}>/.test(line)) return true;
    // An unordered/ordered-1 list marker interrupts; other ordered starts don't.
    const m = matchListMarker(line);
    if (m && (!m.ordered || m.start === 1)) return true;
    if (line.indexOf('|') !== -1 && i + 1 < lines.length && matchTableDelimiter(lines[i + 1])) {
        return true;
    }
    return false;
}

function stripIndent(line: string, n: number): string {
    let i = 0;
    while (i < n && line[i] === ' ') i++;
    return line.slice(i);
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function sameList(a: ListMarkerInfo, b: ListMarkerInfo): boolean {
    return a.ordered === b.ordered && a.delimiter === b.delimiter;
}

function parseList(
    lines: string[],
    start: number,
    first: ListMarkerInfo,
    keys: KeyGen,
    extensions?: readonly ParserInlineExtension[],
): { block: BlockNode; next: number } {
    const items: ListItem[] = [];
    let i = start;
    let tight = true;
    let sawBlankBetween = false;

    while (i < lines.length) {
        const m = matchListMarker(lines[i]) ?? matchEmptyListMarker(lines[i]);
        if (!m || !sameList(m, first) || m.markerIndent >= first.contentIndent) break;

        const itemLines: string[] = [m.content];
        const contentIndent = m.contentIndent;
        i++;
        let pendingBlank = false;

        while (i < lines.length) {
            const cur = lines[i];
            if (isBlank(cur)) {
                pendingBlank = true;
                itemLines.push('');
                i++;
                continue;
            }
            // A new marker for this list ends the current item.
            const nm = matchListMarker(cur) ?? matchEmptyListMarker(cur);
            if (nm && sameList(nm, first) && nm.markerIndent < contentIndent) {
                if (pendingBlank) sawBlankBetween = true;
                break;
            }
            // Indented continuation (nested content, lazy paragraph, sub-list).
            if (indentOf(cur) >= contentIndent) {
                if (pendingBlank) {
                    tight = false;
                    pendingBlank = false;
                }
                itemLines.push(cur.slice(contentIndent));
                i++;
                continue;
            }
            // A blank line followed by an unindented, non-marker line ends the list.
            if (pendingBlank) {
                sawBlankBetween = true;
                break;
            }
            // Lazy paragraph continuation (no indent, not a new block).
            if (!interrupts(lines, i)) {
                itemLines.push(cur);
                i++;
                continue;
            }
            break;
        }

        // Trim a trailing blank line captured at the item boundary.
        while (itemLines.length && itemLines[itemLines.length - 1] === '') itemLines.pop();

        const { checked, lines: bodyLines } = extractTask(itemLines);
        items.push({
            key: keys.next(),
            checked,
            children: parseLines(bodyLines, keys, extensions),
        });
    }

    if (sawBlankBetween) tight = false;

    return {
        block: {
            type: 'list',
            key: keys.next(),
            raw: lines.slice(start, i).join('\n'),
            ordered: first.ordered,
            start: first.start,
            tight,
            items,
        },
        next: i,
    };
}

/** Detect and strip a GFM task-list marker (`[ ]` / `[x]`) from an item. */
function extractTask(itemLines: string[]): { checked: boolean | null; lines: string[] } {
    if (itemLines.length === 0) return { checked: null, lines: itemLines };
    const m = /^\[([ xX])\]\s+(.*)$/.exec(itemLines[0]);
    if (!m) return { checked: null, lines: itemLines };
    const rest = [m[2], ...itemLines.slice(1)];
    return { checked: m[1].toLowerCase() === 'x', lines: rest };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function parseTable(
    lines: string[],
    start: number,
    align: (TableAlign | null)[],
    keys: KeyGen,
    extensions?: readonly ParserInlineExtension[],
): { block: BlockNode; next: number } {
    const header = splitTableRow(lines[start]).map((c): TableCell => ({ children: parseInline(c, extensions) }));
    let i = start + 2; // skip header + delimiter
    const rows: TableCell[][] = [];
    while (i < lines.length && !isBlank(lines[i]) && lines[i].indexOf('|') !== -1 && !interrupts(lines, i)) {
        const cells = splitTableRow(lines[i]).map((c): TableCell => ({ children: parseInline(c, extensions) }));
        // Normalize cell count to the header width.
        while (cells.length < header.length) cells.push({ children: [] });
        rows.push(cells.slice(0, header.length));
        i++;
    }
    return {
        block: {
            type: 'table',
            key: keys.next(),
            raw: lines.slice(start, i).join('\n'),
            align,
            header,
            rows,
        },
        next: i,
    };
}
