/**
 * {@link RichDoc} → markdown — the serializer (inverse of `mdToDoc`).
 *
 * Segments the flat text by `blocks[]` (raw chunks verbatim, heading lines
 * prefixed, remaining lines as paragraphs), then serializes inline spans per
 * segment via elementary runs + a close/reopen delimiter stack (valid nesting
 * from arbitrarily overlapping spans).
 *
 * Round-trip contract: `mdToDoc(docToMd(doc))` is structurally equal to a
 * *normalized* `doc` — emphasis markers, hard breaks (→ paragraph breaks), and
 * blank lines normalize; `raw` blocks round-trip byte-for-byte.
 */

import type { RichDoc } from '@sigx/lynx-richtext';
import { computeRuns, markPriority, type ActiveMark } from './overlap.js';

export function docToMd(doc: RichDoc): string {
    const parts: string[] = [];

    for (const seg of segmentize(doc)) {
        if (seg.type === 'raw') {
            parts.push(doc.text.slice(seg.start, seg.end));
            continue;
        }
        const inline = serializeInline(doc, seg.start, seg.end, seg.type === 'paragraph');
        if (seg.type === 'heading') {
            const level = Math.min(6, Math.max(1, seg.level ?? 1));
            parts.push(`${'#'.repeat(level)} ${inline}`);
        } else if (inline !== '') {
            parts.push(inline);
        }
        // Empty paragraph lines are visual spacing only — they normalize away.
    }

    return parts.join('\n\n');
}

interface Segment {
    start: number;
    /** Exclusive end of the segment's CONTENT (no trailing newline). */
    end: number;
    type: 'paragraph' | 'heading' | 'raw';
    level?: number;
}

/** Cover the text with block segments; uncovered regions split per line into paragraphs. */
function segmentize(doc: RichDoc): Segment[] {
    const segments: Segment[] = [];
    const text = doc.text;
    const blocks = [...doc.blocks]
        .map((b) => ({
            ...b,
            start: Math.max(0, Math.min(b.start, text.length)),
            end: Math.max(0, Math.min(b.end, text.length)),
        }))
        .filter((b) => b.end >= b.start)
        .sort((a, b) => a.start - b.start);

    /**
     * Split an uncovered region `[from, to)` into per-line paragraph segments.
     * A `\n` ends the line before it; a region ending exactly on a separator
     * `\n` emits no phantom trailing line.
     */
    const emitLines = (from: number, to: number): void => {
        let lineStart = from;
        for (let i = from; i < to; i++) {
            if (text[i] === '\n') {
                segments.push({ start: lineStart, end: i, type: 'paragraph' });
                lineStart = i + 1;
            }
        }
        if (lineStart < to) segments.push({ start: lineStart, end: to, type: 'paragraph' });
    };

    let cursor = 0;
    for (const block of blocks) {
        const start = Math.max(cursor, block.start);
        if (start > cursor) emitLines(cursor, start);
        const end = Math.max(start, block.end);
        // Block ranges include their trailing newline (paragraphRange
        // semantics) — content excludes it.
        const contentEnd = end > start && text[end - 1] === '\n' ? end - 1 : end;

        if (block.type === 'heading') {
            segments.push({ start, end: contentEnd, type: 'heading', level: block.level });
        } else if (block.type === 'raw') {
            segments.push({ start, end: contentEnd, type: 'raw' });
        } else {
            // Unknown/unstyled block types degrade to paragraphs (per line).
            emitLines(start, contentEnd);
        }
        cursor = end;
    }

    if (cursor < text.length) emitLines(cursor, text.length);
    return segments;
}

/** Serialize one segment's text + spans into markdown inline syntax. */
function serializeInline(doc: RichDoc, start: number, end: number, escapeLineStart: boolean): string {
    const runs = computeRuns(doc.spans, start, end);
    if (runs.length === 0) {
        return escapeText(doc.text.slice(start, end), escapeLineStart);
    }

    // Extent-aware nesting (the ProseMirror-serializer trick): per run, order
    // marks so the one that stays active the LONGEST sits outermost. A shorter
    // mark is closed-and-reopened inside it, which avoids the unserializable
    // adjacent-delimiter runs (`***`) that naive close/reopen produces.
    const contEnd: Array<Map<string, number>> = [];
    for (let i = runs.length - 1; i >= 0; i--) {
        const map = new Map<string, number>();
        for (const mark of runs[i].active) {
            const next = i + 1 < runs.length ? contEnd[i + 1].get(mark.key) : undefined;
            map.set(mark.key, next !== undefined && runs[i + 1].start === runs[i].end ? next : runs[i].end);
        }
        contEnd[i] = map;
    }

    let out = '';
    const open: ActiveMark[] = [];
    let first = true;

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const desired = [...run.active].sort((a, b) => {
            const ea = contEnd[i].get(a.key) ?? run.end;
            const eb = contEnd[i].get(b.key) ?? run.end;
            return eb - ea || markPriority(a) - markPriority(b);
        });

        // Keep the common open-stack prefix; close the rest (innermost first).
        let keep = 0;
        while (keep < open.length && keep < desired.length && open[keep].key === desired[keep].key) keep++;
        for (let j = open.length - 1; j >= keep; j--) out += delimiter(open[j], doc, 'close');
        open.length = keep;

        for (let j = keep; j < desired.length; j++) {
            out += delimiter(desired[j], doc, 'open');
            open.push(desired[j]);
        }

        const slice = doc.text.slice(run.start, run.end);
        out += open.some((m) => m.type === 'code')
            ? slice
            : escapeText(slice, escapeLineStart && first && open.length === 0);
        first = false;
    }

    for (let j = open.length - 1; j >= 0; j--) out += delimiter(open[j], doc, 'close');
    return out;
}

function delimiter(mark: ActiveMark, doc: RichDoc, side: 'open' | 'close'): string {
    switch (mark.type) {
        case 'bold':
            return '**';
        case 'italic':
            // `_` (not `*`) so a bold/italic split never emits an ambiguous
            // `***` delimiter run (`**a*b***c*` parses wrong; `**a_b_**_c_`
            // can't collide). Trade-off: mid-word italic won't re-parse
            // (intraword `_` rule) — documented normalization.
            return '_';
        case 'strike':
            return '~~';
        case 'code': {
            // Widen the fence beyond any backtick run in the content.
            const fence = '`'.repeat(maxBacktickRun(doc.text) + 1);
            return fence.length > 1 ? fence : '`';
        }
        case 'link':
            return side === 'open' ? '[' : `](${escapeLinkDest(String(mark.attrs?.href ?? ''))})`;
        case 'mention':
            // P3 — until the mention plugin lands, serialize as plain label.
            return '';
        default:
            return '';
    }
}

/**
 * Escape a link destination so it re-parses to the same href (mirrors
 * `scanLinkDest`'s two accepted forms):
 *
 * - bare form: backslash-escape `\`, `(`, `)`, `<` (a leading `<` would
 *   otherwise flip the parser into the angle branch) — valid as long as
 *   the destination has no whitespace;
 * - whitespace anywhere → angle form `<…>`, whose only terminators are `>`
 *   and newline; those get percent-encoded (they're invalid raw in URLs
 *   anyway, so this is normalization, not loss).
 */
function escapeLinkDest(href: string): string {
    if (/\s/.test(href)) {
        return `<${href.replace(/>/g, '%3E').replace(/\n/g, '%0A')}>`;
    }
    return href.replace(/[\\()<]/g, (c) => `\\${c}`);
}

function maxBacktickRun(text: string): number {
    let max = 0;
    let run = 0;
    for (const ch of text) {
        run = ch === '`' ? run + 1 : 0;
        if (run > max) max = run;
    }
    return max;
}

/** Escape markdown-significant characters in literal text. */
function escapeText(text: string, atLineStart: boolean): string {
    let out = text.replace(/([\\`*_~[\]])/g, '\\$1');
    if (atLineStart) {
        // Constructs that only bind at the start of a line.
        out = out
            .replace(/^(#{1,6})(\s)/, '\\$1$2')
            .replace(/^>/, '\\>')
            .replace(/^([-+])(\s)/, '\\$1$2')
            .replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');
    }
    return out;
}
