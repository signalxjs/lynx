/**
 * Elementary-run computation for inline serialization.
 *
 * The doc model permits arbitrarily overlapping spans; markdown needs properly
 * nested delimiters. Step one of the serializer is to slice a text range into
 * **elementary runs** — maximal intervals over which the set of active marks
 * is constant. The emitter (docToMd) then walks the runs with a close/reopen
 * stack, which is guaranteed to produce valid nesting.
 */

import type { InlineSpan, InlineSpanType } from '@sigx/lynx-richtext';

export interface ActiveMark {
    type: InlineSpanType;
    /** Identity key — distinguishes links by href so adjacent different links don't merge. */
    key: string;
    attrs?: Record<string, string>;
}

export interface Run {
    start: number;
    end: number;
    /** Marks active over the whole run. */
    active: ActiveMark[];
}

/** Outer-to-inner nesting priority (lower index opens first / sits outermost). */
const PRIORITY: Record<string, number> = { link: 0, code: 1, bold: 2, italic: 3, strike: 4 };

export function markPriority(mark: ActiveMark): number {
    return PRIORITY[mark.type] ?? 99;
}

/**
 * Slice `[start, end)` into elementary runs for the given spans.
 *
 * `code` is terminal: within a code span every other mark except an enclosing
 * `link` is suppressed (markdown cannot style inside code spans, but
 * `[`code`](href)` is valid).
 */
export function computeRuns(spans: InlineSpan[], start: number, end: number): Run[] {
    if (end <= start) return [];

    const relevant = spans
        .filter((s) => s.end > start && s.start < end && s.end > s.start)
        .map((s) => ({
            start: Math.max(s.start, start),
            end: Math.min(s.end, end),
            mark: toMark(s),
        }));

    const boundaries = new Set<number>([start, end]);
    for (const s of relevant) {
        boundaries.add(s.start);
        boundaries.add(s.end);
    }
    const points = [...boundaries].sort((a, b) => a - b);

    const runs: Run[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (b <= a) continue;
        let active = relevant
            .filter((s) => s.start <= a && s.end >= b)
            .map((s) => s.mark);
        active = dedupe(active);
        if (active.some((m) => m.type === 'code')) {
            active = active.filter((m) => m.type === 'code' || m.type === 'link');
        }
        active.sort((x, y) => markPriority(x) - markPriority(y) || x.key.localeCompare(y.key));
        runs.push({ start: a, end: b, active });
    }
    return runs;
}

function toMark(span: InlineSpan): ActiveMark {
    const key = span.type === 'link' ? `link:${span.attrs?.href ?? ''}` : span.type;
    return { type: span.type, key, ...(span.attrs ? { attrs: span.attrs } : {}) };
}

function dedupe(marks: ActiveMark[]): ActiveMark[] {
    const seen = new Set<string>();
    const out: ActiveMark[] = [];
    for (const m of marks) {
        if (!seen.has(m.key)) {
            seen.add(m.key);
            out.push(m);
        }
    }
    return out;
}
