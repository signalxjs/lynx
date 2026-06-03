/**
 * Inline tokenizer: a markdown text run → `InlineNode[]` (nested spans).
 *
 * Precedence (highest first): backtick code spans, backslash escapes, images,
 * links, angle/bare autolinks, then emphasis (`**`/`__` strong, `*`/`_` em,
 * `~~` del) resolved with a delimiter-run stack, then hard breaks, then text.
 *
 * Robustness for streaming: any unmatched construct at the tail (a lone `**`,
 * a half-open `[text](`, an unterminated code span) degrades to literal text.
 * The function never throws.
 */

import type { InlineNode } from '../ast.js';
import { isEscapable, sanitizeHref, trimAutolinkTail } from './scanner.js';

interface Delim {
    delim: true;
    ch: '*' | '_' | '~';
    count: number;
    canOpen: boolean;
    canClose: boolean;
}

type Token = InlineNode | Delim;

function isDelim(t: Token): t is Delim {
    return (t as Delim).delim === true;
}

const PUNCT = /[!-/:-@[-`{-~]/;

/** Parse an inline text run into a node array. */
export function parseInline(input: string): InlineNode[] {
    const tokens = tokenize(input);
    resolveEmphasis(tokens, 0);
    return coalesce(tokensToNodes(tokens));
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let buf = '';
    const flush = () => {
        if (buf) {
            tokens.push({ type: 'text', value: buf });
            buf = '';
        }
    };

    let i = 0;
    const n = text.length;
    while (i < n) {
        const ch = text[i];

        // Backslash escape / hard break.
        if (ch === '\\') {
            const next = text[i + 1];
            if (next === '\n') {
                flush();
                tokens.push({ type: 'br' });
                i += 2;
                continue;
            }
            if (next !== undefined && isEscapable(next)) {
                buf += next;
                i += 2;
                continue;
            }
            buf += '\\';
            i++;
            continue;
        }

        // Code span.
        if (ch === '`') {
            const span = scanCodeSpan(text, i);
            if (span) {
                flush();
                tokens.push({ type: 'codeSpan', value: span.value });
                i = span.end;
                continue;
            }
            buf += ch;
            i++;
            continue;
        }

        // Image.
        if (ch === '!' && text[i + 1] === '[') {
            const img = scanLink(text, i + 1);
            if (img) {
                flush();
                tokens.push({
                    type: 'image',
                    src: sanitizeHref(img.href),
                    alt: stripFormatting(img.label),
                    ...(img.title ? { title: img.title } : {}),
                });
                i = img.end;
                continue;
            }
            buf += ch;
            i++;
            continue;
        }

        // Link.
        if (ch === '[') {
            const link = scanLink(text, i);
            if (link) {
                flush();
                tokens.push({
                    type: 'link',
                    href: sanitizeHref(link.href),
                    ...(link.title ? { title: link.title } : {}),
                    children: parseInline(link.label),
                });
                i = link.end;
                continue;
            }
            buf += ch;
            i++;
            continue;
        }

        // Angle autolink: <scheme:...> or <email>.
        if (ch === '<') {
            const auto = scanAngleAutolink(text, i);
            if (auto) {
                flush();
                tokens.push({ type: 'autolink', href: sanitizeHref(auto.href), value: auto.value });
                i = auto.end;
                continue;
            }
            buf += ch;
            i++;
            continue;
        }

        // Bare GFM autolink (http(s):// or www.) at a boundary.
        if ((ch === 'h' || ch === 'w') && isBoundary(text[i - 1])) {
            const auto = scanBareAutolink(text, i);
            if (auto) {
                flush();
                tokens.push({ type: 'autolink', href: sanitizeHref(auto.href), value: auto.value });
                i = auto.end;
                continue;
            }
        }

        // Soft line break → single space (paragraphs join their lines).
        if (ch === '\n') {
            // Two trailing spaces before the newline = hard break.
            if (buf.endsWith('  ')) {
                buf = buf.replace(/ +$/, '');
                flush();
                tokens.push({ type: 'br' });
            } else {
                buf = buf.replace(/ +$/, '');
                buf += ' ';
            }
            i++;
            // Skip leading spaces of the continuation line.
            while (i < n && text[i] === ' ') i++;
            continue;
        }

        // Emphasis / strikethrough delimiter run.
        if (ch === '*' || ch === '_' || ch === '~') {
            let j = i;
            while (j < n && text[j] === ch) j++;
            const count = j - i;
            // Single `~` is literal; only `~~` (or longer) marks strikethrough.
            if (ch === '~' && count < 2) {
                buf += text.slice(i, j);
                i = j;
                continue;
            }
            const before = text[i - 1] ?? ' ';
            const after = text[j] ?? ' ';
            const { canOpen, canClose } = flanking(ch, before, after);
            if (!canOpen && !canClose) {
                buf += text.slice(i, j);
            } else {
                flush();
                tokens.push({ delim: true, ch, count, canOpen, canClose });
            }
            i = j;
            continue;
        }

        buf += ch;
        i++;
    }
    flush();
    return tokens;
}

/** Compute flanking rules for an emphasis delimiter run. */
function flanking(ch: string, before: string, after: string): { canOpen: boolean; canClose: boolean } {
    const beforeWs = /\s/.test(before);
    const afterWs = /\s/.test(after);
    const beforePunct = PUNCT.test(before);
    const afterPunct = PUNCT.test(after);

    const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
    const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);

    if (ch === '_') {
        // Intraword underscore does not open/close emphasis.
        return {
            canOpen: leftFlanking && (!rightFlanking || beforePunct),
            canClose: rightFlanking && (!leftFlanking || afterPunct),
        };
    }
    return { canOpen: leftFlanking, canClose: rightFlanking };
}

function isBoundary(prev: string | undefined): boolean {
    return prev === undefined || /[\s(*_~]/.test(prev);
}

// ---------------------------------------------------------------------------
// Code spans, links, autolinks
// ---------------------------------------------------------------------------

function scanCodeSpan(text: string, start: number): { value: string; end: number } | null {
    let open = start;
    while (text[open] === '`') open++;
    const ticks = open - start;
    const close = text.indexOf('`'.repeat(ticks), open);
    if (close === -1) return null;
    // Ensure the closing run is exactly `ticks` long (not part of a longer run).
    if (text[close + ticks] === '`') {
        // Longer run — find a run of exactly `ticks`.
        let k = open;
        while (k < text.length) {
            const idx = text.indexOf('`'.repeat(ticks), k);
            if (idx === -1) return null;
            if (text[idx - 1] !== '`' && text[idx + ticks] !== '`') {
                return finishCodeSpan(text, open, idx, ticks);
            }
            k = idx + ticks;
        }
        return null;
    }
    return finishCodeSpan(text, open, close, ticks);
}

function finishCodeSpan(text: string, open: number, close: number, ticks: number) {
    let value = text.slice(open, close).replace(/\n/g, ' ');
    // Strip one leading and trailing space if the content is not all spaces.
    if (value.length > 1 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
        value = value.slice(1, -1);
    }
    return { value, end: close + ticks };
}

interface LinkScan {
    label: string;
    href: string;
    title?: string;
    end: number;
}

/** Scan `[label](href "title")` starting at the `[`. */
function scanLink(text: string, start: number): LinkScan | null {
    const labelEnd = findClosingBracket(text, start);
    if (labelEnd === -1) return null;
    const label = text.slice(start + 1, labelEnd);
    if (text[labelEnd + 1] !== '(') return null;
    const dest = scanLinkDest(text, labelEnd + 2);
    if (!dest) return null;
    return { label, href: dest.href, ...(dest.title ? { title: dest.title } : {}), end: dest.end };
}

/** Find the `]` matching the `[` at `start`, honoring nesting and escapes. */
function findClosingBracket(text: string, start: number): number {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '`') {
            const span = scanCodeSpan(text, i);
            if (span) {
                i = span.end - 1;
                continue;
            }
        }
        if (ch === '[') depth++;
        else if (ch === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Parse the `href "title")` portion starting just after `(`. */
function scanLinkDest(text: string, start: number): { href: string; title?: string; end: number } | null {
    let i = start;
    while (text[i] === ' ' || text[i] === '\n') i++;
    let href = '';
    if (text[i] === '<') {
        i++;
        while (i < text.length && text[i] !== '>' && text[i] !== '\n') {
            href += text[i];
            i++;
        }
        if (text[i] !== '>') return null;
        i++;
    } else {
        let depth = 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch === '\\' && text[i + 1] !== undefined) {
                href += text[i + 1];
                i += 2;
                continue;
            }
            if (ch === ' ' || ch === '\n') break;
            if (ch === '(') depth++;
            if (ch === ')') {
                if (depth === 0) break;
                depth--;
            }
            href += ch;
            i++;
        }
    }
    // Optional title.
    let title: string | undefined;
    while (text[i] === ' ' || text[i] === '\n') i++;
    const q = text[i];
    if (q === '"' || q === "'" || q === '(') {
        const close = q === '(' ? ')' : q;
        i++;
        let t = '';
        while (i < text.length && text[i] !== close) {
            if (text[i] === '\\' && text[i + 1] !== undefined) {
                t += text[i + 1];
                i += 2;
                continue;
            }
            t += text[i];
            i++;
        }
        if (text[i] !== close) return null;
        title = t;
        i++;
    }
    while (text[i] === ' ' || text[i] === '\n') i++;
    if (text[i] !== ')') return null;
    return { href, ...(title !== undefined ? { title } : {}), end: i + 1 };
}

function scanAngleAutolink(text: string, start: number): { href: string; value: string; end: number } | null {
    const close = text.indexOf('>', start);
    if (close === -1) return null;
    const inner = text.slice(start + 1, close);
    if (/\s/.test(inner) || inner === '') return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(inner)) {
        return { href: inner, value: inner, end: close + 1 };
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inner)) {
        return { href: `mailto:${inner}`, value: inner, end: close + 1 };
    }
    return null;
}

function scanBareAutolink(text: string, start: number): { href: string; value: string; end: number } | null {
    const rest = text.slice(start);
    const m = /^(https?:\/\/|www\.)[^\s<]+/i.exec(rest);
    if (!m) return null;
    const raw = m[0];
    const { url } = trimAutolinkTail(raw);
    // Require something after the scheme/host prefix.
    if (url.length <= m[1].length) return null;
    const href = url.toLowerCase().startsWith('www.') ? `http://${url}` : url;
    return { href, value: url, end: start + url.length };
}

// ---------------------------------------------------------------------------
// Emphasis resolution (delimiter stack)
// ---------------------------------------------------------------------------

function resolveEmphasis(tokens: Token[], lo: number): void {
    // Walk closers left→right; for each, find the nearest compatible opener.
    let i = lo;
    while (i < tokens.length) {
        const closer = tokens[i];
        if (!isDelim(closer) || !closer.canClose || closer.count === 0) {
            i++;
            continue;
        }
        let j = i - 1;
        let matched = false;
        while (j >= lo) {
            const opener = tokens[j];
            if (isDelim(opener) && opener.ch === closer.ch && opener.canOpen && opener.count > 0) {
                // "Rule of 3": when sum is a multiple of 3, both must be too —
                // approximated by allowing the match (good enough for our scope).
                const use = closer.count >= 2 && opener.count >= 2 ? 2 : 1;
                const inner = tokens.slice(j + 1, i).filter((t) => !isDelim(t)) as InlineNode[];
                const node: InlineNode =
                    closer.ch === '~'
                        ? { type: 'del', children: coalesce(inner) }
                        : use === 2
                            ? { type: 'strong', children: coalesce(inner) }
                            : { type: 'em', children: coalesce(inner) };
                // Replace [opener..closer] region: keep leftover opener/closer counts.
                opener.count -= use;
                closer.count -= use;
                const removeStart = j + 1;
                const removeEnd = i; // exclusive of closer
                tokens.splice(removeStart, removeEnd - removeStart, node);
                // Recompute index of closer after splice.
                i = removeStart + 1;
                if (opener.count === 0) {
                    // Leave the empty opener; tokensToNodes ignores count-0 delims.
                }
                matched = true;
                break;
            }
            j--;
        }
        if (!matched) i++;
    }
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

function tokensToNodes(tokens: Token[]): InlineNode[] {
    const out: InlineNode[] = [];
    for (const t of tokens) {
        if (isDelim(t)) {
            // Unmatched / leftover delimiter run → literal text.
            if (t.count > 0) out.push({ type: 'text', value: t.ch.repeat(t.count) });
        } else {
            out.push(t);
        }
    }
    return out;
}

/** Merge adjacent text nodes; drop empty ones. */
function coalesce(nodes: InlineNode[]): InlineNode[] {
    const out: InlineNode[] = [];
    for (const node of nodes) {
        if (node.type === 'text') {
            if (node.value === '') continue;
            const last = out[out.length - 1];
            if (last && last.type === 'text') {
                last.value += node.value;
                continue;
            }
        }
        out.push(node);
    }
    return out;
}

/** Flatten inline nodes to their visible text (for image alt). */
export function stripFormatting(text: string): string {
    return text.replace(/[*_~`[\]]/g, '');
}
