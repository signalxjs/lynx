import { describe, it, expect } from 'vitest';
import { normalizeDoc, type RichDoc } from '@sigx/lynx-richtext';
import { mdToDoc } from '../src/editor/convert/mdToDoc';
import { docToMd } from '../src/editor/convert/docToMd';

/** The round-trip invariant: doc-level idempotence after one normalization. */
function roundTrip(doc: RichDoc): RichDoc {
    return mdToDoc(docToMd(doc));
}

function expectDocStable(doc: RichDoc): void {
    const again = roundTrip(doc);
    expect(normalizeDoc(again)).toEqual(normalizeDoc({ ...doc, v: 0 }));
}

describe('mdToDoc', () => {
    it('maps a plain paragraph', () => {
        expect(mdToDoc('hello world')).toEqual({
            text: 'hello world',
            spans: [],
            blocks: [],
            v: 0,
        });
    });

    it('maps inline formats to overlapping spans', () => {
        const doc = mdToDoc('a **bold _both_** and `code`');
        expect(doc.text).toBe('a bold both and code');
        expect(normalizeDoc(doc).spans).toEqual([
            { start: 2, end: 11, type: 'bold' },
            { start: 7, end: 11, type: 'italic' },
            { start: 16, end: 20, type: 'code' },
        ]);
    });

    it('maps links (and autolinks) with hrefs', () => {
        const doc = mdToDoc('see [docs](https://x.dev) or https://y.dev');
        expect(doc.text).toBe('see docs or https://y.dev');
        expect(doc.spans).toEqual([
            { start: 4, end: 8, type: 'link', attrs: { href: 'https://x.dev' } },
            { start: 12, end: 25, type: 'link', attrs: { href: 'https://y.dev' } },
        ]);
    });

    it('maps headings to block attrs (range includes the separator)', () => {
        const doc = mdToDoc('# Title\n\nbody');
        expect(doc.text).toBe('Title\nbody');
        expect(doc.blocks).toEqual([{ start: 0, end: 6, type: 'heading', level: 1 }]);
    });

    it('splits hard breaks into separate doc lines', () => {
        const doc = mdToDoc('line one  \nline two');
        expect(doc.text).toBe('line one\nline two');
        expect(doc.blocks).toEqual([]);
    });

    it('maps bullet lists to per-line blocks (markers never in text)', () => {
        const doc = mdToDoc('- a\n- b');
        expect(doc.text).toBe('a\nb');
        expect(doc.blocks).toEqual([
            { start: 0, end: 2, type: 'bullet' },
            { start: 2, end: 3, type: 'bullet' },
        ]);
    });

    it('maps ordered lists; a non-1 start rides level on the first line', () => {
        expect(mdToDoc('1. one\n2. two').blocks).toEqual([
            { start: 0, end: 4, type: 'ordered' },
            { start: 4, end: 7, type: 'ordered' },
        ]);
        const doc = mdToDoc('3. three\n4. four');
        expect(doc.text).toBe('three\nfour');
        expect(doc.blocks).toEqual([
            { start: 0, end: 6, type: 'ordered', level: 3 },
            { start: 6, end: 10, type: 'ordered' },
        ]);
    });

    it('maps task lists with checked state', () => {
        const doc = mdToDoc('- [ ] todo\n- [x] done');
        expect(doc.text).toBe('todo\ndone');
        expect(doc.blocks).toEqual([
            { start: 0, end: 5, type: 'task', checked: false },
            { start: 5, end: 9, type: 'task', checked: true },
        ]);
    });

    it('keeps inline formatting inside list items', () => {
        const doc = mdToDoc('- has **bold** and [link](https://x.dev)');
        expect(doc.text).toBe('has bold and link');
        expect(normalizeDoc(doc).spans).toEqual([
            { start: 4, end: 8, type: 'bold' },
            { start: 13, end: 17, type: 'link', attrs: { href: 'https://x.dev' } },
        ]);
        expect(doc.blocks).toEqual([{ start: 0, end: 17, type: 'bullet' }]);
    });

    it('maps blockquotes of plain paragraphs (soft-wrapped lines join)', () => {
        const doc = mdToDoc('> quoted lines');
        expect(doc.text).toBe('quoted lines');
        expect(doc.blocks).toEqual([{ start: 0, end: 12, type: 'blockquote' }]);
    });

    it('maps code fences per content line, carrying lang on every line', () => {
        const doc = mdToDoc('```ts\nconst x = 1\nconst y = 2\n```');
        expect(doc.text).toBe('const x = 1\nconst y = 2');
        expect(doc.blocks).toEqual([
            { start: 0, end: 12, type: 'codeBlock', lang: 'ts' },
            { start: 12, end: 23, type: 'codeBlock', lang: 'ts' },
        ]);
    });

    it('keeps code-fence content literal (no inline spans)', () => {
        const doc = mdToDoc('```\n**not bold**\n```');
        expect(doc.text).toBe('**not bold**');
        expect(doc.spans).toEqual([]);
        expect(doc.blocks).toEqual([{ start: 0, end: 12, type: 'codeBlock' }]);
    });

    it('degrades lists the flat model cannot hold to raw', () => {
        for (const md of [
            '- a\n  - nested', // nesting
            '- a\n\n- b', // loose
            '- a\n\n  continuation', // multi-paragraph item
        ]) {
            const doc = mdToDoc(md);
            expect(doc.blocks.map((b) => b.type)).toEqual(['raw']);
            expect(doc.text).toBe(md);
        }
    });

    it('degrades blockquotes containing non-paragraphs to raw', () => {
        for (const md of ['> - a\n> - b', '> # heading']) {
            const doc = mdToDoc(md);
            expect(doc.blocks.map((b) => b.type)).toEqual(['raw']);
            expect(doc.text).toBe(md);
        }
    });

    it('keeps tables raw', () => {
        const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
        const doc = mdToDoc(md);
        expect(doc.text).toBe(md);
        expect(doc.blocks).toEqual([{ start: 0, end: md.length, type: 'raw' }]);
    });

    it('sends paragraphs containing images to raw', () => {
        const md = 'pic: ![alt](http://x/i.png)';
        const doc = mdToDoc(md);
        expect(doc.blocks).toEqual([{ start: 0, end: md.length, type: 'raw' }]);
        expect(doc.text).toBe(md);
    });
});

describe('docToMd', () => {
    it('serializes paragraphs separated by blank lines', () => {
        const doc: RichDoc = { text: 'a\nb', spans: [], blocks: [], v: 0 };
        expect(docToMd(doc)).toBe('a\n\nb');
    });

    it('serializes nested + overlapping spans with valid nesting', () => {
        // bold [0,9), italic [5,13) — partial overlap forces a split.
        const doc: RichDoc = {
            text: 'aaaaabbbbcccc',
            spans: [
                { start: 0, end: 9, type: 'bold' },
                { start: 5, end: 13, type: 'italic' },
            ],
            blocks: [],
            v: 0,
        };
        const md = docToMd(doc);
        const back = mdToDoc(md);
        expect(back.text).toBe(doc.text);
        // Coverage is preserved even though span boundaries may split.
        expect(coverage(back, 'bold')).toEqual([[0, 9]]);
        expect(coverage(back, 'italic')).toEqual([[5, 13]]);
    });

    it('escapes markdown specials in plain text', () => {
        const doc: RichDoc = { text: 'a *b* [c] #d', spans: [], blocks: [], v: 0 };
        const md = docToMd(doc);
        expect(mdToDoc(md).text).toBe('a *b* [c] #d');
        expect(mdToDoc(md).spans).toEqual([]);
    });

    it('escapes line-start constructs so paragraphs stay paragraphs', () => {
        for (const text of ['# not a heading', '> not a quote', '- not a list', '1. not ordered']) {
            const doc: RichDoc = { text, spans: [], blocks: [], v: 0 };
            const back = mdToDoc(docToMd(doc));
            expect(back.text).toBe(text);
            expect(back.blocks).toEqual([]);
        }
    });

    it('round-trips raw blocks byte-for-byte', () => {
        const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
        const doc = mdToDoc(table);
        expect(doc.blocks[0].type).toBe('raw');
        expect(docToMd(doc)).toBe(table);
    });

    it('synthesizes list markers; adjacent same-kind lines form one list', () => {
        const doc: RichDoc = {
            text: 'a\nb\npara',
            spans: [],
            blocks: [
                { start: 0, end: 2, type: 'bullet' },
                { start: 2, end: 4, type: 'bullet' },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('- a\n- b\n\npara');
    });

    it('numbers ordered runs positionally, honoring a level start, restarting after a break', () => {
        const doc: RichDoc = {
            text: 'three\nfour\nbreak\none',
            spans: [],
            blocks: [
                { start: 0, end: 6, type: 'ordered', level: 3 },
                { start: 6, end: 11, type: 'ordered' },
                { start: 17, end: 20, type: 'ordered' },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('3. three\n4. four\n\nbreak\n\n1. one');
    });

    it('serializes task markers from checked', () => {
        const doc: RichDoc = {
            text: 'todo\ndone',
            spans: [],
            blocks: [
                { start: 0, end: 5, type: 'task', checked: false },
                { start: 5, end: 9, type: 'task', checked: true },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('- [ ] todo\n- [x] done');
    });

    it('different list families never merge into one list', () => {
        const doc: RichDoc = {
            text: 'a\nb',
            spans: [],
            blocks: [
                { start: 0, end: 2, type: 'bullet' },
                { start: 2, end: 3, type: 'task', checked: false },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('- a\n\n- [ ] b');
    });

    it('fences code runs with lang, widening past content backticks', () => {
        const doc: RichDoc = {
            text: 'plain\ncode',
            spans: [],
            blocks: [
                { start: 0, end: 6, type: 'codeBlock', lang: 'ts' },
                { start: 6, end: 10, type: 'codeBlock', lang: 'ts' },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('```ts\nplain\ncode\n```');

        const ticks: RichDoc = {
            text: 'has ``` inside',
            spans: [],
            blocks: [{ start: 0, end: 14, type: 'codeBlock' }],
            v: 0,
        };
        expect(docToMd(ticks)).toBe('````\nhas ``` inside\n````');
    });

    it('splits code runs when lang changes', () => {
        const doc: RichDoc = {
            text: 'a\nb',
            spans: [],
            blocks: [
                { start: 0, end: 2, type: 'codeBlock', lang: 'ts' },
                { start: 2, end: 3, type: 'codeBlock', lang: 'js' },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('```ts\na\n```\n\n```js\nb\n```');
    });

    it('escapes line-start constructs inside list items', () => {
        const doc: RichDoc = {
            text: '- not nested',
            spans: [],
            blocks: [{ start: 0, end: 12, type: 'bullet' }],
            v: 0,
        };
        expect(docToMd(doc)).toBe('- \\- not nested');
        expectDocStable(doc);
    });

    it('serializes quote lines as quote paragraphs (line convention)', () => {
        const doc: RichDoc = {
            text: 'first\nsecond',
            spans: [],
            blocks: [
                { start: 0, end: 6, type: 'blockquote' },
                { start: 6, end: 12, type: 'blockquote' },
            ],
            v: 0,
        };
        expect(docToMd(doc)).toBe('> first\n>\n> second');
        expectDocStable(doc);
    });
});

describe('docToMd link destination escaping', () => {
    const linkDoc = (href: string): RichDoc => ({
        text: 'a link b',
        spans: [{ start: 2, end: 6, type: 'link', attrs: { href } }],
        blocks: [],
        v: 0,
    });

    it('backslash-escapes parens and backslashes in bare destinations', () => {
        expect(docToMd(linkDoc('/a(b)c'))).toBe('a [link](/a\\(b\\)c) b');
        expect(docToMd(linkDoc('/a\\b'))).toBe('a [link](/a\\\\b) b');
    });

    it('escapes a leading `<` so the parser stays in the bare branch', () => {
        expect(docToMd(linkDoc('<weird'))).toBe('a [link](\\<weird) b');
    });

    it('wraps whitespace-bearing destinations in angle brackets', () => {
        expect(docToMd(linkDoc('/a b/c'))).toBe('a [link](</a b/c>) b');
    });

    // '' is absent: mdToDoc normalizes an empty destination to '#'.
    for (const href of ['/a(b)c', '/a\\b', '<weird', '/a b/c', '#']) {
        it(`round-trips href ${JSON.stringify(href)}`, () => {
            expectDocStable(linkDoc(href));
        });
    }
});

describe('round-trip idempotence (md → doc → md → doc)', () => {
    const cases = [
        'hello world',
        '# Title\n\nbody text',
        'a **bold** b *it* c ~~strike~~ d `code`',
        '**bold _nested_ rest**',
        '[label](https://x.dev) tail',
        'multi\n\nparagraph\n\ndoc',
        '## H2 with **bold**',
        '- list\n- items\n\npara after',
        '```ts\nconst x = 1\n```',
        'mixed\n\n# Head\n\n- raw list\n\ntail `code`',
        // Block WYSIWYG (#153): native list / quote / fence blocks.
        '- a\n- b',
        '1. one\n2. two',
        '3. three\n4. four',
        '- [ ] todo\n- [x] done',
        '> quoted lines',
        '> first\n>\n> second',
        '```\nplain code\n```',
        '```\n\n```',
        '- has **bold** and [link](https://x.dev)',
        'intro\n\n- a\n- b\n\noutro',
        '> q\n\npara\n\n- l1\n- l2',
        '1. ordered\n\n- bullet',
        // Flat-model degrades (stay raw, byte-for-byte).
        '- a\n  - nested',
        '- loose\n\n- list',
        '> - quoted list',
        '---',
    ];
    for (const md of cases) {
        it(`stable for: ${JSON.stringify(md.slice(0, 32))}`, () => {
            expectDocStable(mdToDoc(md));
        });
    }
});

/** Merged coverage intervals for a span type (split-tolerant comparison). */
function coverage(doc: RichDoc, type: string): Array<[number, number]> {
    const ranges = doc.spans
        .filter((s) => s.type === type)
        .map((s) => [s.start, s.end] as [number, number])
        .sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [s, e] of ranges) {
        const last = merged[merged.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else merged.push([s, e]);
    }
    return merged;
}

// ---------------------------------------------------------------------------
// Plugin inline mapping (P3): extension node ↔ editor span ↔ markdown
// ---------------------------------------------------------------------------

describe('plugin inline mapping', () => {
    // The reference mention shape (#157): @[label](id) ↔ a 'mention' span.
    const mentionSyntax = {
        name: 'mention',
        triggerChars: ['@'] as const,
        match(text: string, pos: number) {
            const m = /^@\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(text.slice(pos));
            if (!m) return null;
            return {
                node: {
                    type: 'extension' as const,
                    name: 'mention',
                    attrs: { label: m[1], id: m[2] },
                    raw: m[0],
                },
                end: pos + m[0].length,
            };
        },
    };
    const inOpts = {
        extensions: [mentionSyntax],
        spanMappers: {
            mention: (node: { attrs: Record<string, string> }) => ({
                text: node.attrs.label,
                span: { type: 'mention' as const, attrs: { id: node.attrs.id, label: node.attrs.label } },
            }),
        },
    };
    const outOpts = {
        serializers: new Map([
            ['mention', (span: { attrs?: Record<string, string> }, text: string) =>
                `@[${text}](${span.attrs?.id ?? ''})`],
        ]),
    };

    it('maps a mention to a span showing the label (not a raw block)', () => {
        const doc = mdToDoc('ping @[Andy](u1)!', 0, inOpts);
        expect(doc.text).toBe('ping Andy!');
        expect(doc.blocks).toEqual([]);
        expect(doc.spans).toEqual([
            { start: 5, end: 9, type: 'mention', attrs: { id: 'u1', label: 'Andy' } },
        ]);
    });

    it('serializes a mention span back atomically', () => {
        const doc = mdToDoc('ping @[Andy](u1)!', 0, inOpts);
        expect(docToMd(doc, outOpts)).toBe('ping @[Andy](u1)!');
    });

    it('round-trips a mention wrapped in other formatting', () => {
        const md = '**hi @[Andy](u1) yo**';
        const doc = mdToDoc(md, 0, inOpts);
        expect(doc.text).toBe('hi Andy yo');
        expect(docToMd(doc, outOpts)).toBe(md);
    });

    it('keeps the block raw when no mapper handles the extension', () => {
        const doc = mdToDoc('ping @[Andy](u1)!', 0, { extensions: inOpts.extensions });
        expect(doc.blocks).toEqual([{ start: 0, end: 17, type: 'raw' }]);
        expect(doc.text).toBe('ping @[Andy](u1)!');
        // Raw blocks serialize byte-for-byte even without plugin serializers.
        expect(docToMd(doc)).toBe('ping @[Andy](u1)!');
    });

    it('mentions degrade to their label without a serializer (documented v1)', () => {
        const doc = mdToDoc('ping @[Andy](u1)!', 0, inOpts);
        expect(docToMd(doc)).toBe('ping Andy!');
    });
});

describe('plugin mapper hardening', () => {
    const syntax = {
        name: 'mention',
        triggerChars: ['@'] as const,
        match(text: string, pos: number) {
            const m = /^@\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(text.slice(pos));
            if (!m) return null;
            return {
                node: { type: 'extension' as const, name: 'mention', attrs: { label: m[1], id: m[2] }, raw: m[0] },
                end: pos + m[0].length,
            };
        },
    };

    it('treats a throwing mapper as not representable (raw block, no crash)', () => {
        const doc = mdToDoc('hi @[Andy](u1)', 0, {
            extensions: [syntax],
            spanMappers: {
                mention: () => {
                    throw new Error('plugin bug');
                },
            },
        });
        expect(doc.blocks).toEqual([{ start: 0, end: 14, type: 'raw' }]);
        expect(doc.text).toBe('hi @[Andy](u1)');
    });

    it('falls back to raw text when an impure mapper disagrees with the probe', () => {
        // Accepts the representability probe, then fails during flattening —
        // the source text must survive instead of being dropped.
        let calls = 0;
        const doc = mdToDoc('hi @[Andy](u1)', 0, {
            extensions: [syntax],
            spanMappers: {
                mention: (node) => {
                    calls++;
                    if (calls > 1) throw new Error('impure');
                    return { text: node.attrs.label, span: { type: 'mention' } };
                },
            },
        });
        expect(doc.text).toBe('hi @[Andy](u1)');
        expect(doc.spans).toEqual([]);
    });
});

describe('overlapping plugin spans', () => {
    it('degrades ambiguous runs to plain text instead of dropping content', () => {
        // Two different plugin-owned span types over the same range — atomic
        // serialization is ambiguous, so the covered text must survive as-is.
        const doc: RichDoc = {
            text: 'hi Andy!',
            spans: [
                { start: 3, end: 7, type: 'mention', attrs: { id: 'u1' } },
                { start: 3, end: 7, type: 'code' },
            ],
            blocks: [],
            v: 0,
        };
        const out = docToMd(doc, {
            serializers: new Map([
                ['mention', (s, t) => `@[${t}](${s.attrs?.id ?? ''})`],
                ['code', (_s, t) => `~${t}~`],
            ]),
        });
        expect(out).toContain('Andy');
    });
});
