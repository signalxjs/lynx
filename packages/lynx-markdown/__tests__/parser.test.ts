import { describe, it, expect } from 'vitest';
import { parseInline } from '../src/parser/inline';
import { parseBlocks } from '../src/parser/blocks';
import type { BlockNode } from '../src/ast';

describe('parseInline', () => {
    it('parses plain text', () => {
        expect(parseInline('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
    });

    it('parses bold with surrounding text', () => {
        expect(parseInline('a **b** c')).toEqual([
            { type: 'text', value: 'a ' },
            { type: 'strong', children: [{ type: 'text', value: 'b' }] },
            { type: 'text', value: ' c' },
        ]);
    });

    it('parses italic with underscore', () => {
        expect(parseInline('_x_')).toEqual([
            { type: 'em', children: [{ type: 'text', value: 'x' }] },
        ]);
    });

    it('does not treat intraword underscores as emphasis', () => {
        expect(parseInline('foo_bar_baz')).toEqual([{ type: 'text', value: 'foo_bar_baz' }]);
    });

    it('parses nested emphasis', () => {
        expect(parseInline('**a _b_ c**')).toEqual([
            {
                type: 'strong',
                children: [
                    { type: 'text', value: 'a ' },
                    { type: 'em', children: [{ type: 'text', value: 'b' }] },
                    { type: 'text', value: ' c' },
                ],
            },
        ]);
    });

    it('parses strikethrough', () => {
        expect(parseInline('~~gone~~')).toEqual([
            { type: 'del', children: [{ type: 'text', value: 'gone' }] },
        ]);
    });

    it('parses a code span (literal content)', () => {
        expect(parseInline('use `a*b` now')).toEqual([
            { type: 'text', value: 'use ' },
            { type: 'codeSpan', value: 'a*b' },
            { type: 'text', value: ' now' },
        ]);
    });

    it('parses a link with title', () => {
        expect(parseInline('[t](http://x "hi")')).toEqual([
            { type: 'link', href: 'http://x', title: 'hi', children: [{ type: 'text', value: 't' }] },
        ]);
    });

    it('parses an image', () => {
        expect(parseInline('![alt](http://img.png)')).toEqual([
            { type: 'image', src: 'http://img.png', alt: 'alt' },
        ]);
    });

    it('parses an angle autolink', () => {
        expect(parseInline('<https://x.com>')).toEqual([
            { type: 'autolink', href: 'https://x.com', value: 'https://x.com' },
        ]);
    });

    it('parses a bare GFM autolink and trims trailing punctuation', () => {
        expect(parseInline('see https://x.com.')).toEqual([
            { type: 'text', value: 'see ' },
            { type: 'autolink', href: 'https://x.com', value: 'https://x.com' },
            { type: 'text', value: '.' },
        ]);
    });

    it('honors backslash escapes', () => {
        expect(parseInline('a \\* b')).toEqual([{ type: 'text', value: 'a * b' }]);
    });

    it('sanitizes javascript: hrefs', () => {
        const out = parseInline('[x](javascript:alert(1))');
        expect(out).toEqual([{ type: 'link', href: '#', children: [{ type: 'text', value: 'x' }] }]);
    });

    // -- streaming-tail edge cases: never throw, degrade to literal --
    it('renders a lone delimiter literally', () => {
        expect(parseInline('text **bo')).toEqual([{ type: 'text', value: 'text **bo' }]);
    });

    it('renders a half-open link literally', () => {
        expect(parseInline('[anchor](')).toEqual([{ type: 'text', value: '[anchor](' }]);
    });

    it('renders an unterminated code span literally', () => {
        expect(parseInline('a `b')).toEqual([{ type: 'text', value: 'a `b' }]);
    });
});

describe('parseBlocks', () => {
    const types = (b: BlockNode[]) => b.map((x) => x.type);

    it('parses ATX headings', () => {
        const b = parseBlocks('# One\n\n### Three');
        expect(types(b)).toEqual(['heading', 'heading']);
        expect((b[0] as any).level).toBe(1);
        expect((b[1] as any).level).toBe(3);
    });

    it('parses a paragraph joining soft-wrapped lines', () => {
        const b = parseBlocks('line one\nline two');
        expect(b).toHaveLength(1);
        expect(b[0].type).toBe('paragraph');
        expect((b[0] as any).children).toEqual([{ type: 'text', value: 'line one line two' }]);
    });

    it('parses a fenced code block with language and inner blank lines', () => {
        const b = parseBlocks('```ts\na\n\nb\n```');
        expect(b).toHaveLength(1);
        expect(b[0]).toMatchObject({ type: 'codeBlock', lang: 'ts', value: 'a\n\nb', closed: true });
    });

    it('keeps an unterminated fence open', () => {
        const b = parseBlocks('```\ncode');
        expect(b[0]).toMatchObject({ type: 'codeBlock', value: 'code', closed: false });
    });

    it('parses a blockquote with nested blocks', () => {
        const b = parseBlocks('> # Q\n> body');
        expect(b[0].type).toBe('blockquote');
        expect(types((b[0] as any).children)).toEqual(['heading', 'paragraph']);
    });

    it('parses an unordered list', () => {
        const b = parseBlocks('- a\n- b');
        expect(b[0].type).toBe('list');
        expect((b[0] as any).ordered).toBe(false);
        expect((b[0] as any).items).toHaveLength(2);
    });

    it('parses an ordered list with a start number', () => {
        const b = parseBlocks('3. a\n4. b');
        expect(b[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
    });

    it('parses task list items', () => {
        const b = parseBlocks('- [ ] todo\n- [x] done');
        const items = (b[0] as any).items;
        expect(items[0].checked).toBe(false);
        expect(items[1].checked).toBe(true);
    });

    it('parses thematic breaks (and not as a list)', () => {
        expect(parseBlocks('* * *')[0].type).toBe('thematicBreak');
        expect(parseBlocks('---')[0].type).toBe('thematicBreak');
    });

    it('parses a GFM table with alignment', () => {
        const b = parseBlocks('| a | b | c |\n| :-- | :--: | --: |\n| 1 | 2 | 3 |');
        expect(b[0].type).toBe('table');
        expect((b[0] as any).align).toEqual(['left', 'center', 'right']);
        expect((b[0] as any).rows).toHaveLength(1);
    });

    it('treats an incomplete table as a paragraph', () => {
        const b = parseBlocks('| a | b |');
        expect(b[0].type).toBe('paragraph');
    });

    it('renders raw HTML as literal text (no HTML sink)', () => {
        const b = parseBlocks('<script>alert(1)</script>');
        expect(b[0].type).toBe('paragraph');
        const text = (b[0] as any).children.map((c: any) => c.value).join('');
        expect(text).toContain('<script>');
    });

    it('handles empty input', () => {
        expect(parseBlocks('')).toEqual([]);
    });

    it('does not throw on partial streaming input', () => {
        const partials = ['#', '# H', '# H\n\n- ', '# H\n\n- a\n\n```', '# H\n\n```\ncode'];
        for (const p of partials) expect(() => parseBlocks(p)).not.toThrow();
    });
});
