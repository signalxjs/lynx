import { describe, it, expect } from 'vitest';
import { decodeDoc, docEquals, emptyDoc, encodeDoc, normalizeDoc } from '../src/model/codec';
import type { RichDoc } from '../src/model/types';

const sample: RichDoc = {
    text: 'Hello bold world\nHeading line',
    spans: [
        { start: 6, end: 10, type: 'bold' },
        { start: 6, end: 10, type: 'italic' },
        { start: 11, end: 16, type: 'link', attrs: { href: 'https://x.dev' } },
    ],
    blocks: [{ start: 17, end: 29, type: 'heading', level: 2 }],
    v: 7,
};

describe('codec', () => {
    it('round-trips a document', () => {
        const decoded = decodeDoc(encodeDoc(sample));
        expect(decoded).toEqual(sample);
        expect(docEquals(decoded, sample)).toBe(true);
    });

    it('degrades malformed JSON to an empty doc (never throws)', () => {
        expect(decodeDoc('{nope')).toEqual(emptyDoc());
        expect(decodeDoc('')).toEqual(emptyDoc());
        expect(decodeDoc(undefined)).toEqual(emptyDoc());
    });

    it('clamps out-of-range spans and drops empty ones', () => {
        const doc = decodeDoc(JSON.stringify({
            text: 'abc',
            spans: [
                { start: 1, end: 99, type: 'bold' },
                { start: 2, end: 2, type: 'italic' },
                { start: -5, end: 2, type: 'strike' },
            ],
            blocks: [],
            v: 1,
        }));
        expect(doc.spans).toEqual([
            { start: 1, end: 3, type: 'bold' },
            { start: 0, end: 2, type: 'strike' },
        ]);
    });

    it('docEquals ignores version but not content', () => {
        const a = { ...sample, v: 1 };
        const b = { ...sample, v: 99 };
        expect(docEquals(a, b)).toBe(true);
        expect(docEquals(a, { ...a, text: a.text + '!' })).toBe(false);
        expect(docEquals(a, {
            ...a,
            spans: [{ ...a.spans[0], end: 11 }, a.spans[1], a.spans[2]],
        })).toBe(false);
    });

    it('drops spans/blocks with unknown or non-string types and bad attr shapes', () => {
        const doc = decodeDoc(JSON.stringify({
            text: 'hello',
            spans: [
                { start: 0, end: 5, type: 'bold' },
                { start: 0, end: 5, type: 'sparkle' },        // unknown vocab
                { start: 0, end: 5, type: 42 },               // non-string type
                { start: 0, end: 5, type: 'link', attrs: ['nope'] }, // array attrs
            ],
            blocks: [
                { start: 0, end: 5, type: 'heading', level: 2.9, checked: 'yes' },
                { start: 0, end: 5, type: 'banner' },         // unknown vocab
            ],
            v: 1,
        }));
        expect(doc.spans).toEqual([
            { start: 0, end: 5, type: 'bold' },
            { start: 0, end: 5, type: 'link' },               // attrs dropped, span kept
        ]);
        // level floored to an int; non-boolean checked dropped.
        expect(doc.blocks).toEqual([{ start: 0, end: 5, type: 'heading', level: 2 }]);
    });

    it('normalizeDoc orders spans/blocks deterministically', () => {
        const shuffled: RichDoc = {
            ...sample,
            spans: [sample.spans[2], sample.spans[1], sample.spans[0]],
        };
        expect(docEquals(normalizeDoc(shuffled), normalizeDoc(sample))).toBe(true);
    });
});
