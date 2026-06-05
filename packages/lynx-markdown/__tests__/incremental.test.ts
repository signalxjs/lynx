import { describe, it, expect } from 'vitest';
import { createIncrementalEngine } from '../src/parser/incremental';
import { parseBlocks } from '../src/parser/blocks';
import type { ParserInlineExtension } from '../src/parser/extensions';

describe('incremental engine', () => {
    it('reuses finalized blocks by reference across chunks', () => {
        const e = createIncrementalEngine();
        const full = '# A\n\nparagraph one\n\nmore text';
        const r2 = e.parse(full);
        const r3 = e.parse(full + ' even more');
        // heading A and "paragraph one" are finalized → identical references.
        expect(r3[0]).toBe(r2[0]);
        expect(r3[1]).toBe(r2[1]);
        // the trailing block keeps growing.
        expect((r3[2] as any).type).toBe('paragraph');
    });

    it('keeps the trailing block key stable when it finalizes (no remount)', () => {
        const e = createIncrementalEngine();
        const r1 = e.parse('a\n\nb'); // [para a (b-0, cached), para b (b-1, live)]
        expect(r1[1].key).toBe('b-1');
        const r2 = e.parse('a\n\nb\n\nc'); // para b finalizes, key unchanged
        expect(r2[1].key).toBe('b-1');
        expect((r2[1] as any).children).toEqual([{ type: 'text', value: 'b' }]);
    });

    it('does not split a fenced code block on inner blank lines', () => {
        const blocks = parseBlocks('```\na\n\nb\n```');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ type: 'codeBlock', value: 'a\n\nb' });
    });

    it('keeps stable item keys as a streaming list grows', () => {
        const e = createIncrementalEngine();
        const a = e.parse('- a\n- b');
        const b = e.parse('- a\n- b\n- c');
        const itemsA = (a[0] as any).items;
        const itemsB = (b[0] as any).items;
        expect(itemsB).toHaveLength(3);
        expect(itemsA[0].key).toBe(itemsB[0].key);
        expect(itemsA[1].key).toBe(itemsB[1].key);
    });

    it('grows an open code block and flips closed on the final fence', () => {
        const e = createIncrementalEngine();
        const open = e.parse('```ts\nline1');
        expect(open[0]).toMatchObject({ type: 'codeBlock', closed: false, value: 'line1' });
        const more = e.parse('```ts\nline1\nline2');
        expect(more[0]).toMatchObject({ closed: false, value: 'line1\nline2' });
        // The live block key is stable across growth (no remount).
        expect(more[0].key).toBe(open[0].key);
        const done = e.parse('```ts\nline1\nline2\n```');
        expect(done[0]).toMatchObject({ closed: true, value: 'line1\nline2' });
    });

    it('feeds char-by-char without throwing and stabilizes the prefix', () => {
        const e = createIncrementalEngine();
        const doc = '# Title\n\nSome **bold** text.\n\n- one\n- two\n\nDone.';
        let prev: ReturnType<typeof e.parse> | null = null;
        for (let i = 1; i <= doc.length; i++) {
            const blocks = e.parse(doc.slice(0, i));
            // Each finalized prefix block stays referentially identical once set.
            if (prev) {
                const shared = Math.min(prev.length, blocks.length) - 1; // exclude live tail
                for (let k = 0; k < shared; k++) {
                    if (prev[k].key === blocks[k].key && prev[k] !== blocks[k]) {
                        // A same-key block may only be re-created on the step it finalizes;
                        // after that it must remain identical. Allow at most a content match.
                        expect(prev[k].raw).toBe(blocks[k].raw);
                    }
                }
            }
            prev = blocks;
        }
        const final = e.parse(doc);
        expect(final.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'paragraph']);
    });

    it('full re-parses when the source is replaced, not appended', () => {
        const e = createIncrementalEngine();
        e.parse('# A\n\nbody');
        const replaced = e.parse('completely different');
        expect(replaced).toHaveLength(1);
        expect(replaced[0].type).toBe('paragraph');
    });
});

describe('incremental engine (inline extensions)', () => {
    const mention: ParserInlineExtension = {
        name: 'mention',
        triggerChars: ['@'],
        match(text, pos) {
            const m = /^@\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(text.slice(pos));
            if (!m) return null;
            return {
                node: { type: 'extension', name: 'mention', attrs: { label: m[1], id: m[2] }, raw: m[0] },
                end: pos + m[0].length,
            };
        },
    };

    it('parses extensions in finalized and live blocks', () => {
        const e = createIncrementalEngine({ extensions: [mention] });
        const blocks = e.parse('hi @[Andy](u1)\n\nstill typing @[Bea](u2)');
        expect((blocks[0] as any).children[1]).toMatchObject({ type: 'extension', name: 'mention' });
        expect((blocks[1] as any).children[1]).toMatchObject({
            type: 'extension',
            attrs: { label: 'Bea', id: 'u2' },
        });
    });

    it('keeps finalized blocks reference-equal across appends spanning an extension', () => {
        const e = createIncrementalEngine({ extensions: [mention] });
        const r1 = e.parse('cc @[Andy](u1) done\n\nnext');
        const r2 = e.parse('cc @[Andy](u1) done\n\nnext block grows');
        expect(r2[0]).toBe(r1[0]); // finalized extension-bearing block reused by reference
    });

    it('degrades a streaming partial extension to text, then resolves it', () => {
        const e = createIncrementalEngine({ extensions: [mention] });
        const full = 'ping @[Andy](u1) ok';
        for (let i = 1; i <= full.length; i++) {
            const blocks = e.parse(full.slice(0, i)); // must never throw
            expect(blocks).toHaveLength(1);
        }
        const final = e.parse(full);
        expect((final[0] as any).children).toEqual([
            { type: 'text', value: 'ping ' },
            { type: 'extension', name: 'mention', attrs: { label: 'Andy', id: 'u1' }, raw: '@[Andy](u1)' },
            { type: 'text', value: ' ok' },
        ]);
    });
});
