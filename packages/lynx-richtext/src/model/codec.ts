/**
 * The single JSON codec for {@link RichDoc} — used by the `value` prop,
 * `setDocument`/`getDocument`, and `bindchange` payloads, so there is exactly
 * one wire schema and one validation point.
 *
 * `decodeDoc` is defensive: malformed input degrades to an empty document
 * rather than throwing (events from native should never crash the BG thread).
 */

import type { BlockAttr, BlockAttrType, InlineSpan, InlineSpanType, RichDoc } from './types.js';

const INLINE_TYPES: ReadonlySet<string> = new Set(
    ['bold', 'italic', 'strike', 'code', 'link', 'mention'] satisfies InlineSpanType[],
);
const BLOCK_TYPES: ReadonlySet<string> = new Set(
    ['paragraph', 'heading', 'bullet', 'ordered', 'task', 'blockquote', 'codeBlock', 'raw'] satisfies BlockAttrType[],
);

export function emptyDoc(v = 0): RichDoc {
    return { text: '', spans: [], blocks: [], v };
}

export function encodeDoc(doc: RichDoc): string {
    return JSON.stringify(doc);
}

export function decodeDoc(raw: string | null | undefined): RichDoc {
    if (!raw) return emptyDoc();
    try {
        const parsed = JSON.parse(raw) as Partial<RichDoc>;
        const text = typeof parsed.text === 'string' ? parsed.text : '';
        return {
            text,
            spans: sanitizeSpans(parsed.spans, text.length),
            blocks: sanitizeBlocks(parsed.blocks, text.length),
            v: typeof parsed.v === 'number' && Number.isFinite(parsed.v) ? parsed.v : 0,
        };
    } catch {
        return emptyDoc();
    }
}

function sanitizeSpans(spans: unknown, max: number): InlineSpan[] {
    if (!Array.isArray(spans)) return [];
    const out: InlineSpan[] = [];
    for (const s of spans as InlineSpan[]) {
        if (!s || typeof s.start !== 'number' || typeof s.end !== 'number') continue;
        if (typeof s.type !== 'string' || !INLINE_TYPES.has(s.type)) continue;
        const start = clamp(s.start, 0, max);
        const end = clamp(s.end, 0, max);
        if (end <= start) continue;
        const attrs = s.attrs && typeof s.attrs === 'object' && !Array.isArray(s.attrs) ? s.attrs : undefined;
        out.push({ start, end, type: s.type, ...(attrs ? { attrs } : {}) });
    }
    return out;
}

function sanitizeBlocks(blocks: unknown, max: number): BlockAttr[] {
    if (!Array.isArray(blocks)) return [];
    const out: BlockAttr[] = [];
    for (const b of blocks as BlockAttr[]) {
        if (!b || typeof b.start !== 'number' || typeof b.end !== 'number') continue;
        if (typeof b.type !== 'string' || !BLOCK_TYPES.has(b.type)) continue;
        const start = clamp(b.start, 0, max);
        const end = clamp(b.end, 0, max);
        if (end < start) continue;
        out.push({
            start,
            end,
            type: b.type,
            ...(typeof b.level === 'number' && Number.isFinite(b.level) ? { level: Math.floor(b.level) } : {}),
            ...(typeof b.checked === 'boolean' ? { checked: b.checked } : {}),
            // `lang` is a codeBlock-only field (model contract) — dropped
            // elsewhere so stray wire data can't skew docEquals.
            ...(b.type === 'codeBlock' && typeof b.lang === 'string' && b.lang !== '' ? { lang: b.lang } : {}),
        });
    }
    return out;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * Structural equality, ignoring `v` — the echo-suppression comparison.
 * (Two docs with identical content but different versions are "equal": the
 * version exists to order writes, not to distinguish content.)
 */
export function docEquals(a: RichDoc, b: RichDoc): boolean {
    if (a === b) return true;
    if (a.text !== b.text) return false;
    if (a.spans.length !== b.spans.length || a.blocks.length !== b.blocks.length) return false;
    for (let i = 0; i < a.spans.length; i++) {
        const x = a.spans[i];
        const y = b.spans[i];
        if (x.start !== y.start || x.end !== y.end || x.type !== y.type) return false;
        if (!attrsEqual(x.attrs, y.attrs)) return false;
    }
    for (let i = 0; i < a.blocks.length; i++) {
        const x = a.blocks[i];
        const y = b.blocks[i];
        if (
            x.start !== y.start || x.end !== y.end || x.type !== y.type ||
            x.level !== y.level || x.checked !== y.checked || x.lang !== y.lang
        ) return false;
    }
    return true;
}

function attrsEqual(
    a: Record<string, string> | undefined,
    b: Record<string, string> | undefined,
): boolean {
    if (a === b) return true;
    const ka = a ? Object.keys(a) : [];
    const kb = b ? Object.keys(b) : [];
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a![k] !== b?.[k]) return false;
    return true;
}

/**
 * Normalize a doc so structurally-identical content compares equal regardless
 * of producer ordering: spans sorted by (start, end, type), blocks by start.
 */
export function normalizeDoc(doc: RichDoc): RichDoc {
    return {
        text: doc.text,
        spans: [...doc.spans].sort(
            (a, b) => a.start - b.start || a.end - b.end || a.type.localeCompare(b.type),
        ),
        blocks: [...doc.blocks].sort((a, b) => a.start - b.start),
        v: doc.v,
    };
}
