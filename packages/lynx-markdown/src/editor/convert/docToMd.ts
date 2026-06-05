/**
 * {@link RichDoc} → markdown — the serializer (inverse of `mdToDoc`).
 *
 * Segments the flat text by `blocks[]` (raw chunks verbatim; heading / list /
 * blockquote / codeBlock lines get their markers re-synthesized — markers are
 * never in the doc text; remaining lines as paragraphs), then serializes
 * inline spans per segment via elementary runs + a close/reopen delimiter
 * stack (valid nesting from arbitrarily overlapping spans).
 *
 * Consecutive same-kind block lines join into one group (`\n`-separated:
 * a tight list, one quote, one fence); groups separate with blank lines.
 * Ordered numbering derives from the run position, restarting at each run's
 * first-line `level` (a non-1 start) — so two adjacent ordered runs merge
 * into one list (the flat model has no list-boundary marker; documented
 * normalization, idempotent).
 *
 * Round-trip contract: `mdToDoc(docToMd(doc))` is structurally equal to a
 * *normalized* `doc` — emphasis markers, hard breaks (→ paragraph breaks), and
 * blank lines normalize; `raw` blocks round-trip byte-for-byte.
 */

import type { InlineSpan, RichDoc } from '@sigx/lynx-richtext';
import { computeRuns, markPriority, type ActiveMark } from './overlap.js';

/** Serialize one plugin-owned span back to markdown (a plugin's `inline.serialize`). */
export type SpanSerializer = (span: InlineSpan, text: string) => string;

export interface DocToMdOptions {
    /**
     * Plugin serializers keyed by the span type they own
     * (`docMapping.spanType`). A plugin-owned span is emitted **atomically**:
     * the serializer's output replaces the covered text entirely.
     */
    serializers?: ReadonlyMap<string, SpanSerializer>;
}

export function docToMd(doc: RichDoc, options?: DocToMdOptions): string {
    const groups: string[] = [];
    const serializers = options?.serializers;
    // Plugin-owned spans, prefiltered once for the whole doc — the per-run
    // lookup searches only these (typically zero or a handful).
    const pluginSpans = serializers ? doc.spans.filter((s) => serializers.has(s.type)) : [];

    // Consecutive same-kind block lines accumulate into one `\n`-joined
    // group; groups join with blank lines. List families never merge
    // (bullet→task etc. starts a new list); code groups split on `lang`.
    let group: string[] = [];
    let groupKind = '';
    let orderedCounter = 0;
    const flush = (): void => {
        if (group.length) {
            if (groupKind.startsWith('codeBlock:')) {
                // Fence the collected code run — wider than any backtick run
                // in the content, the info string straight from `lang`.
                const lang = groupKind.slice('codeBlock:'.length);
                const content = group.join('\n');
                const fence = '`'.repeat(Math.max(3, maxBacktickRun(content) + 1));
                groups.push(`${fence}${lang}\n${content}\n${fence}`);
            } else if (groupKind === 'blockquote') {
                // A blank quote line between paragraphs — a plain `\n` would
                // re-parse as one soft-wrapped line (every doc line is a
                // paragraph; the line convention, applied inside the quote).
                groups.push(group.join('\n>\n'));
            } else {
                groups.push(group.join('\n'));
            }
        }
        group = [];
        groupKind = '';
    };
    const append = (kind: string, line: string): void => {
        if (kind !== groupKind) {
            flush();
            groupKind = kind;
        }
        group.push(line);
    };

    for (const seg of segmentize(doc)) {
        if (seg.type !== 'ordered') orderedCounter = 0;
        switch (seg.type) {
            case 'raw':
                flush();
                groups.push(doc.text.slice(seg.start, seg.end));
                break;
            case 'heading': {
                flush();
                const inline = serializeInline(doc, seg.start, seg.end, false, serializers, pluginSpans);
                const level = Math.min(6, Math.max(1, seg.level ?? 1));
                groups.push(`${'#'.repeat(level)} ${inline}`);
                break;
            }
            case 'bullet':
                append('bullet', `- ${serializeInline(doc, seg.start, seg.end, true, serializers, pluginSpans)}`);
                break;
            case 'ordered': {
                // A new run restarts at the first line's `level` (non-1 start).
                if (orderedCounter === 0) orderedCounter = Math.max(1, seg.level ?? 1);
                else orderedCounter++;
                append('ordered', `${orderedCounter}. ${serializeInline(doc, seg.start, seg.end, true, serializers, pluginSpans)}`);
                break;
            }
            case 'task':
                append('task', `- [${seg.checked ? 'x' : ' '}] ${serializeInline(doc, seg.start, seg.end, true, serializers, pluginSpans)}`);
                break;
            case 'blockquote':
                append('blockquote', `> ${serializeInline(doc, seg.start, seg.end, true, serializers, pluginSpans)}`);
                break;
            case 'codeBlock':
                // Content is literal — collected per `lang`-keyed run and
                // fenced once per group below.
                append(`codeBlock:${seg.lang ?? ''}`, doc.text.slice(seg.start, seg.end));
                break;
            default: {
                flush();
                const inline = serializeInline(doc, seg.start, seg.end, true, serializers, pluginSpans);
                // Empty paragraph lines are visual spacing only — they
                // normalize away.
                if (inline !== '') groups.push(inline);
                break;
            }
        }
    }
    flush();

    return groups.join('\n\n');
}

type SegmentType =
    | 'paragraph'
    | 'heading'
    | 'raw'
    | 'bullet'
    | 'ordered'
    | 'task'
    | 'blockquote'
    | 'codeBlock';

interface Segment {
    start: number;
    /** Exclusive end of the segment's CONTENT (no trailing newline). */
    end: number;
    type: SegmentType;
    /** Heading level, or the ordered run's start number on its first line. */
    level?: number;
    /** Task checkbox state. */
    checked?: boolean;
    /** Code fence info string. */
    lang?: string;
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
        } else if (
            block.type === 'bullet' || block.type === 'ordered' || block.type === 'task' ||
            block.type === 'blockquote' || block.type === 'codeBlock'
        ) {
            // One segment per line (producers emit one block attr per line;
            // a multi-line range from a foreign producer splits defensively,
            // each line carrying the block's attrs — `level` only on the
            // first so an ordered start isn't repeated).
            let lineStart = start;
            let first = true;
            const emit = (from: number, to: number): void => {
                // Empty list/quote lines carry no content — they normalize
                // away like empty paragraphs (blank lines only stay
                // meaningful inside code fences).
                if (from === to && block.type !== 'codeBlock') {
                    segments.push({ start: from, end: to, type: 'paragraph' });
                    first = false;
                    return;
                }
                segments.push({
                    start: from,
                    end: to,
                    type: block.type as SegmentType,
                    ...(first && block.level !== undefined ? { level: block.level } : {}),
                    ...(block.checked !== undefined ? { checked: block.checked } : {}),
                    ...(block.lang !== undefined ? { lang: block.lang } : {}),
                });
                first = false;
            };
            for (let i = start; i < contentEnd; i++) {
                if (text[i] === '\n') {
                    emit(lineStart, i);
                    lineStart = i + 1;
                }
            }
            emit(lineStart, contentEnd);
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
function serializeInline(
    doc: RichDoc,
    start: number,
    end: number,
    escapeLineStart: boolean,
    serializers?: ReadonlyMap<string, SpanSerializer>,
    pluginSpans: readonly InlineSpan[] = [],
): string {
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
        // A plugin-owned mark serializes atomically: its serializer output
        // replaces the covered text, and the mark never enters the
        // close/reopen stack (other marks may still wrap it). Atomic emission
        // only applies when exactly ONE plugin mark covers the run —
        // overlapping plugin spans are ambiguous, so the run degrades to its
        // plain text (content preserved, no plugin syntax emitted).
        const pluginMarks = serializers ? run.active.filter((m) => serializers.has(m.type)) : [];
        const pluginMark = pluginMarks.length === 1 ? pluginMarks[0] : undefined;
        const active = pluginMarks.length ? run.active.filter((m) => !serializers!.has(m.type)) : run.active;
        const desired = [...active].sort((a, b) => {
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

        if (pluginMark) {
            // Emit the serialized form once — on the span's first run within
            // this segment — and suppress the covered text everywhere.
            const span = pluginSpans.find(
                (s) => s.type === pluginMark.type && s.start <= run.start && s.end >= run.end,
            );
            if (span && run.start === Math.max(span.start, start)) {
                out += serializers!.get(pluginMark.type)!(span, doc.text.slice(span.start, span.end));
            }
            first = false;
            continue;
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
