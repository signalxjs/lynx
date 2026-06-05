import { describe, it, expect } from 'vitest';
import { render, fireEvent, waitForUpdate } from '@sigx/lynx-testing';
import { component, signal } from '@sigx/lynx';
import { MarkdownView } from '../src/render/MarkdownView';
import type { ParserInlineExtension } from '../src/parser/extensions';

describe('MarkdownView (default components)', () => {
    it('renders the root as a flex column container', () => {
        const { container } = render(<MarkdownView value="# Hi" />);
        const root = container.children[0];
        expect(root.type).toBe('view');
        expect(root._style.display).toBe('flex');
        expect(root._style.flexDirection).toBe('column');
        expect(root._style.gap).toBe(10);
    });

    it('renders a heading with inline size/weight styles', () => {
        const { container } = render(<MarkdownView value="# Hi" />);
        const text = container.findAllByType('text')[0];
        expect(text._style.fontSize).toBe(30);
        expect(text._style.fontWeight).toBe(700);
        expect(container.findByText('Hi')).toBeTruthy();
    });

    it('renders bold as a nested <text> with fontWeight', () => {
        const { container } = render(<MarkdownView value="a **b** c" />);
        const bold = container.findAllByType('text').find((t) => t._style.fontWeight === 700);
        expect(bold).toBeTruthy();
        expect(bold!.findByText('b')).toBeTruthy();
    });

    it('renders italic and strikethrough via inline styles', () => {
        const { container } = render(<MarkdownView value="_i_ and ~~s~~" />);
        const texts = container.findAllByType('text');
        expect(texts.some((t) => t._style.fontStyle === 'italic')).toBe(true);
        expect(texts.some((t) => t._style.textDecoration === 'line-through')).toBe(true);
    });

    it('renders a fenced code block with a language label', () => {
        const { container } = render(<MarkdownView value={'```ts\nconst x = 1\n```'} />);
        expect(container.findByText('const x = 1')).toBeTruthy();
        expect(container.findByText('ts')).toBeTruthy();
    });

    it('renders a list as flex rows with drawn circle bullets', () => {
        const { container } = render(<MarkdownView value={'- a\n- b'} />);
        const rows = container.findAllByType('view').filter((v) => v._style.flexDirection === 'row');
        expect(rows.length).toBeGreaterThanOrEqual(2);
        // Bullets are drawn circles (a sized view with a full border-radius), not glyphs.
        const dots = container.findAllByType('view').filter(
            (v) => v._style.width === 6 && v._style.height === 6 && v._style.borderRadius === 3,
        );
        expect(dots.length).toBe(2);
    });

    it('fires onLink when a link is tapped', () => {
        let linked = '';
        const { container } = render(
            <MarkdownView value="[go](http://example.com)" onLink={(h) => { linked = h; }} />,
        );
        const link = container.findAllByType('text').find((t) => t._handlers.has('bindtap'));
        expect(link).toBeTruthy();
        fireEvent.tap(link!);
        expect(linked).toBe('http://example.com');
    });
});

describe('MarkdownView (component overrides)', () => {
    it('uses a custom heading renderer', () => {
        const { container } = render(
            <MarkdownView
                value="# Hi"
                components={{ heading: ({ children }) => <text class="custom-h1">{children}</text> }}
            />,
        );
        const text = container.findAllByType('text')[0];
        expect(text._class).toBe('custom-h1');
        expect(container.findByText('Hi')).toBeTruthy();
    });

    it('still renders non-overridden nodes with defaults', () => {
        const { container } = render(
            <MarkdownView
                value={'# Hi\n\nbody'}
                components={{ heading: ({ children }) => <text class="custom-h1">{children}</text> }}
            />,
        );
        // paragraph still uses the default inline style.
        const body = container.findByText('body');
        expect(body).toBeTruthy();
    });
});

describe('MarkdownView (inline extensions)', () => {
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

    it('dispatches to components.extension[name] with attrs', () => {
        const { container } = render(
            <MarkdownView
                value="hi @[Andy](u1)"
                extensions={[mention]}
                components={{
                    extension: {
                        mention: ({ attrs }) => <text class="mention">@{attrs.label}</text>,
                    },
                }}
            />,
        );
        const chip = container.findAllByType('text').find((t) => t._class === 'mention');
        expect(chip).toBeTruthy();
        expect(chip!.findByText('Andy')).toBeTruthy();
    });

    it('falls back to the raw source as text when no renderer is registered', () => {
        const { container } = render(
            <MarkdownView value="hi @[Andy](u1)" extensions={[mention]} />,
        );
        expect(container.findByText('@[Andy](u1)')).toBeTruthy();
    });
});

describe('MarkdownView (streaming reconciliation)', () => {
    it('keeps the first block mounted while a second streams in', async () => {
        const src = signal('first para');
        const Wrap = component(() => () => <MarkdownView value={src.value} />);
        const { container } = render(<Wrap />);

        const firstBlock = container.children[0].children[0];
        expect(container.findByText('first para')).toBeTruthy();

        src.value = 'first para\n\nsecond para';
        await waitForUpdate();

        // Stable key → the finalized first block's host node is reused (no remount).
        expect(container.children[0].children[0]).toBe(firstBlock);
        expect(container.findByText('second para')).toBeTruthy();
    });
});
