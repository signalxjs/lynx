import { describe, it, expect } from 'vitest';
import { render, fireEvent, waitForUpdate } from '@sigx/lynx-testing';
import { component, signal } from '@sigx/lynx';
import { MarkdownView } from '../src/render/MarkdownView';
import { mentionPlugin, type Mention, type MarkdownPlugin } from '../src/index';

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

    it('sanitises link URLs at render time', () => {
        let linked = '';
        const { container } = render(
            <MarkdownView value="[x](javascript:alert(1))" onLink={(h) => { linked = h; }} />,
        );
        const link = container.findAllByType('text').find((t) => t._handlers.has('bindtap'));
        fireEvent.tap(link!);
        expect(linked).toBe('#');
    });

    it('fires onImageTap with the image URL', () => {
        let tapped = '';
        const { container } = render(
            <MarkdownView value="![pic](http://x/i.png)" onImageTap={(u) => { tapped = u; }} />,
        );
        const img = container.findAllByType('text').find((t) => t._handlers.has('bindtap'));
        expect(img!.findByText('pic')).toBeTruthy();
        fireEvent.tap(img!);
        expect(tapped).toBe('http://x/i.png');
    });

    it('joins soft line breaks with a space (no literal newline reaches <text>)', () => {
        const { container } = render(<MarkdownView value={'line one\nline two'} />);
        expect(container.findByText('line one line two')).toBeTruthy();
    });

    it('renders a hard break as a newline', () => {
        const { container } = render(<MarkdownView value={'line one  \nline two'} />);
        const para = container.findAllByType('text')[0];
        expect(para.findByText('\n')).toBeTruthy();
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

describe('MarkdownView (plugins)', () => {
    it('dispatches a plugin node to components[node.type]', () => {
        const { container } = render(
            <MarkdownView
                value="hi @[Andy](u1)"
                plugins={[mentionPlugin]}
                components={{
                    mention: ({ node }: { node: Mention }) => <text class="mention">@{node.label}</text>,
                }}
            />,
        );
        const chip = container.findAllByType('text').find((t) => t._class === 'mention');
        expect(chip).toBeTruthy();
        expect(chip!.findByText('Andy')).toBeTruthy();
    });

    it("falls back to the plugin's serialize rule as text when no renderer is registered", () => {
        const { container } = render(
            <MarkdownView value="hi @[Andy](u1)" plugins={[mentionPlugin]} />,
        );
        expect(container.findByText('@[Andy](u1)')).toBeTruthy();
    });

    it('re-parses from scratch when the plugins prop changes identity', async () => {
        const plugins = signal<{ current: readonly MarkdownPlugin[] }>({ current: [] });
        const Wrap = component(() => () => (
            <MarkdownView value="hi @[Andy](u1)" plugins={plugins.current} />
        ));
        const { container } = render(<Wrap />);
        // Without the plugin, `[Andy](u1)` is an ordinary inline link.
        expect(container.findByText('hi @')).toBeTruthy();
        expect(container.findAllByType('text').some((t) => t._handlers.has('bindtap'))).toBe(true);

        plugins.current = [mentionPlugin];
        await waitForUpdate();
        // Parsed as a mention now (no renderer → the serialize-rule text); the link is gone.
        expect(container.findByText('@[Andy](u1)')).toBeTruthy();
        expect(container.findAllByType('text').some((t) => t._handlers.has('bindtap'))).toBe(false);
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
