/**
 * Shared low-level scanning helpers: source normalization, line classification,
 * escape handling, and URL scanning. Pure functions, no AST/JSX dependency.
 */

import type { HeadingLevel, TableAlign } from '../ast.js';

/** Characters that may be backslash-escaped in markdown to their literal form. */
const ESCAPABLE = new Set('\\`*_{}[]()#+-.!>~|"\'');

/**
 * Normalize source for uniform parsing: CRLF/CR → LF, and expand leading tabs
 * to four spaces so indentation logic is consistent. Tabs after the first
 * non-space content are left alone (they only matter for block indentation).
 */
export function normalize(src: string): string {
    const unified = src.replace(/\r\n?/g, '\n');
    if (unified.indexOf('\t') === -1) return unified;
    return unified
        .split('\n')
        .map(expandLeadingTabs)
        .join('\n');
}

function expandLeadingTabs(line: string): string {
    let i = 0;
    let out = '';
    let col = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === '\t') {
            const next = col + (4 - (col % 4));
            out += ' '.repeat(next - col);
            col = next;
        } else if (ch === ' ') {
            out += ' ';
            col++;
        } else {
            break;
        }
        i++;
    }
    return out + line.slice(i);
}

/** Count leading spaces (indentation) of a line. */
export function indentOf(line: string): number {
    let i = 0;
    while (i < line.length && line[i] === ' ') i++;
    return i;
}

/** True when a line is blank (empty or whitespace-only). */
export function isBlank(line: string): boolean {
    return /^\s*$/.test(line);
}

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

export interface FenceInfo {
    /** The fence character: '`' or '~'. */
    char: string;
    /** Length of the fence run (≥ 3). */
    length: number;
    /** Indentation of the fence (stripped from content lines). */
    indent: number;
    /** Trimmed info string (language) after the opening fence, if any. */
    info: string;
}

/** Match an opening (or closing) fenced-code-block marker. */
export function matchFence(line: string): FenceInfo | null {
    const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) return null;
    const fence = m[2];
    const info = m[3].trim();
    // An opening info string for a backtick fence may not contain a backtick.
    if (fence[0] === '`' && info.indexOf('`') !== -1) return null;
    return { char: fence[0], length: fence.length, indent: m[1].length, info };
}

/** True when `line` closes a fence opened by `open`. */
export function isFenceClose(line: string, open: FenceInfo): boolean {
    const m = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(line);
    if (!m) return false;
    const fence = m[2];
    return fence[0] === open.char && fence.length >= open.length;
}

/** Match an ATX heading (`#`..`######`). Returns level + text, or null. */
export function matchHeading(line: string): { level: HeadingLevel; text: string } | null {
    const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (!m) return null;
    // A `#` must be followed by a space or end of line to be a heading.
    if (m[2] === undefined && line.replace(/^ {0,3}#{1,6}/, '').trim() !== '') return null;
    return { level: m[1].length as HeadingLevel, text: (m[2] ?? '').trim() };
}

/** Match a thematic break (`---`, `***`, `___`, optionally spaced). */
export function isThematicBreak(line: string): boolean {
    const t = line.trim();
    if (t.length < 3) return false;
    if (!/^[-*_]/.test(t)) return false;
    const ch = t[0];
    return t.split('').every((c) => c === ch || c === ' ') &&
        t.replace(/\s/g, '').length >= 3;
}

export interface ListMarkerInfo {
    ordered: boolean;
    /** Start number (ordered) or 1 (unordered). */
    start: number;
    /** The bullet/delimiter char: '-', '*', '+', '.', or ')'. */
    delimiter: string;
    /** Column where the item content begins (used for continuation indent). */
    contentIndent: number;
    /** Indentation of the marker itself. */
    markerIndent: number;
    /** The content following the marker on the same line. */
    content: string;
}

/** Match a list-item marker (`- `, `* `, `+ `, `1. `, `1) `). */
export function matchListMarker(line: string): ListMarkerInfo | null {
    const m = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(.*)$/.exec(line);
    if (!m) return null;
    const markerIndent = m[1].length;
    const ordered = m[3] !== undefined;
    const delimiter = ordered ? m[4] : m[2];
    const markerText = ordered ? m[3] + m[4] : (m[2] as string);
    const spaces = m[5].length;
    const contentIndent = markerIndent + markerText.length + spaces;
    return {
        ordered,
        start: ordered ? parseInt(m[3], 10) : 1,
        delimiter,
        markerIndent,
        contentIndent,
        content: m[6],
    };
}

/** Match an empty list item (`-` / `1.` with nothing after). */
export function matchEmptyListMarker(line: string): ListMarkerInfo | null {
    const m = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))[ \t]*$/.exec(line);
    if (!m) return null;
    const markerIndent = m[1].length;
    const ordered = m[3] !== undefined;
    const delimiter = ordered ? m[4] : m[2];
    const markerText = ordered ? m[3] + m[4] : (m[2] as string);
    return {
        ordered,
        start: ordered ? parseInt(m[3], 10) : 1,
        delimiter,
        markerIndent,
        contentIndent: markerIndent + markerText.length + 1,
        content: '',
    };
}

/**
 * Parse a GFM table delimiter row (`| --- | :--: | --: |`) into per-column
 * alignment, or return null if the line is not a valid delimiter row.
 */
export function matchTableDelimiter(line: string): (TableAlign | null)[] | null {
    const t = line.trim();
    if (t.indexOf('-') === -1) return null;
    const cells = splitTableRow(t);
    if (cells.length === 0) return null;
    const align: (TableAlign | null)[] = [];
    for (const cell of cells) {
        const c = cell.trim();
        if (!/^:?-+:?$/.test(c)) return null;
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        align.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
    }
    return align;
}

/** Split a table row into raw cell strings, honoring `\|` escapes. */
export function splitTableRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells: string[] = [];
    let buf = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' && s[i + 1] === '|') {
            buf += '|';
            i++;
        } else if (ch === '|') {
            cells.push(buf);
            buf = '';
        } else {
            buf += ch;
        }
    }
    cells.push(buf);
    return cells.map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Escapes & URLs
// ---------------------------------------------------------------------------

/** True when `ch` is a backslash-escapable punctuation character. */
export function isEscapable(ch: string): boolean {
    return ESCAPABLE.has(ch);
}

/** A conservative URL scheme allow-list for link safety. */
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

/**
 * Return a link href if it is safe to expose to handlers, else `'#'`. Blocks
 * `javascript:`/`data:` and other unexpected schemes. Relative/anchor links and
 * the recognized safe schemes pass through unchanged.
 */
export function sanitizeHref(href: string): string {
    const h = href.trim();
    if (h === '') return '#';
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
        return SAFE_SCHEME.test(h) ? h : '#';
    }
    // No scheme → relative, anchor, or protocol-relative; allow.
    return h;
}

/** Trailing punctuation trimmed from bare-URL autolinks (GFM behavior). */
export function trimAutolinkTail(url: string): { url: string; tail: string } {
    let end = url.length;
    while (end > 0 && '?!.,:*_~)'.includes(url[end - 1])) {
        // A trailing ')' is only trimmed when unbalanced within the URL.
        if (url[end - 1] === ')') {
            const open = (url.slice(0, end).match(/\(/g) ?? []).length;
            const close = (url.slice(0, end).match(/\)/g) ?? []).length;
            if (close <= open) break;
        }
        end--;
    }
    return { url: url.slice(0, end), tail: url.slice(end) };
}
