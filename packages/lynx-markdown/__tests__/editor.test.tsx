import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitForUpdate } from '@sigx/lynx-testing';
import { component, signal } from '@sigx/lynx';
import { encodeDoc, RichTextMethods, type RichDoc } from '@sigx/lynx-richtext';
import { MarkdownEditor, type MarkdownEditorController } from '../src/editor/MarkdownEditor';
import { mdToDoc } from '../src/editor/convert/mdToDoc';

// RichTextMethods is the shared command surface — spying on it observes
// exactly what the editor asks the native element to do.
const spies = {
    setDocument: vi.spyOn(RichTextMethods, 'setDocument'),
    toggleFormat: vi.spyOn(RichTextMethods, 'toggleFormat'),
    setBlockType: vi.spyOn(RichTextMethods, 'setBlockType'),
    applyFormat: vi.spyOn(RichTextMethods, 'applyFormat'),
    insertText: vi.spyOn(RichTextMethods, 'insertText'),
};

beforeEach(() => {
    for (const spy of Object.values(spies)) spy.mockClear().mockImplementation(() => {});
});
afterEach(() => {
    for (const spy of Object.values(spies)) spy.mockReset();
});

function fireChange(el: { _handlers: Map<string, Function> }, doc: RichDoc, isComposing = false): void {
    el._handlers.get('bindchange')!({
        type: 'change',
        detail: { doc: encodeDoc(doc), isComposing },
    });
}

describe('MarkdownEditor', () => {
    it('passes the initial value to the element as an encoded doc', () => {
        const { container } = render(<MarkdownEditor value="# Hi" />);
        const el = container.findByType('sigx-richtext')!;
        const doc = JSON.parse(el.props['value'] as string);
        expect(doc.text).toBe('Hi');
        expect(doc.blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    });

    it('always passes a concrete editable boolean — Android coerces undefined to false (#182)', () => {
        // No `disabled` prop — must be editable.
        const a = render(<MarkdownEditor value="" />);
        expect(a.container.findByType('sigx-richtext')!.props['editable']).toBe(true);

        // Explicit disabled={false} — still editable.
        const b = render(<MarkdownEditor value="" disabled={false} />);
        expect(b.container.findByType('sigx-richtext')!.props['editable']).toBe(true);

        // disabled — not editable.
        const c = render(<MarkdownEditor value="" disabled={true} />);
        expect(c.container.findByType('sigx-richtext')!.props['editable']).toBe(false);
    });

    it('emits onChange with serialized markdown on element changes', () => {
        const onChange = vi.fn();
        const { container } = render(<MarkdownEditor value="" onChange={onChange} />);
        const el = container.findByType('sigx-richtext')!;

        fireChange(el, mdToDoc('hello **bold**', 1));
        expect(onChange).toHaveBeenCalledWith('hello **bold**');
        expect(spies.setDocument).not.toHaveBeenCalled();
    });

    it('does not echo its own onChange output back as setDocument', async () => {
        const value = signal('');
        const onChange = vi.fn((md: string) => {
            value.value = md; // parent echoes the editor's output straight back
        });
        const Wrap = component(() => () => (
            <MarkdownEditor value={value.value} onChange={onChange} />
        ));
        const { container } = render(<Wrap />);
        const el = container.findByType('sigx-richtext')!;

        fireChange(el, mdToDoc('typed text', 1));
        await waitForUpdate();

        expect(onChange).toHaveBeenCalledWith('typed text');
        expect(spies.setDocument).not.toHaveBeenCalled();
    });

    it('pushes genuinely external values via setDocument', async () => {
        const value = signal('initial');
        const Wrap = component(() => () => <MarkdownEditor value={value.value} />);
        render(<Wrap />);
        expect(spies.setDocument).not.toHaveBeenCalled();

        value.value = '# Replaced';
        await waitForUpdate();

        expect(spies.setDocument).toHaveBeenCalledTimes(1);
        const doc = spies.setDocument.mock.calls[0][1] as RichDoc;
        expect(doc.text).toBe('Replaced');
        expect(doc.blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    });

    it('suppresses onChange and buffers external values while composing', async () => {
        const onChange = vi.fn();
        const value = signal('');
        const Wrap = component(() => () => (
            <MarkdownEditor value={value.value} onChange={onChange} />
        ));
        const { container } = render(<Wrap />);
        const el = container.findByType('sigx-richtext')!;

        // IME composition in progress: no onChange.
        fireChange(el, mdToDoc('かn', 1), true);
        expect(onChange).not.toHaveBeenCalled();

        // External value arrives mid-composition: buffered, not pushed.
        value.value = 'external';
        await waitForUpdate();
        expect(spies.setDocument).not.toHaveBeenCalled();

        // Composition ends: onChange fires, then the buffered external applies.
        fireChange(el, mdToDoc('かんじ', 2), false);
        expect(onChange).toHaveBeenCalledWith('かんじ');
        expect(spies.setDocument).toHaveBeenCalledTimes(1);
        expect((spies.setDocument.mock.calls[0][1] as RichDoc).text).toBe('external');
    });

    it('exposes a controller whose commands invoke element methods', () => {
        let ctrl: MarkdownEditorController | null = null;
        render(<MarkdownEditor value="" controllerRef={(c) => { ctrl = c; }} />);

        ctrl!.toggleBold();
        expect(spies.toggleFormat).toHaveBeenCalledWith(expect.anything(), 'bold');

        ctrl!.setHeading(2);
        expect(spies.setBlockType).toHaveBeenCalledWith(expect.anything(), 'heading', 2);

        ctrl!.clear();
        expect(spies.setDocument).toHaveBeenCalledTimes(1);
        expect((spies.setDocument.mock.calls[0][1] as RichDoc).text).toBe('');
    });

    it('setList / toggleQuote drive setBlockType (block-WYSIWYG, #153)', () => {
        let ctrl: MarkdownEditorController | null = null;
        const { container } = render(<MarkdownEditor value="" controllerRef={(c) => { ctrl = c; }} />);
        const el = container.findByType('sigx-richtext')!;

        ctrl!.setList('bullet');
        expect(spies.setBlockType).toHaveBeenLastCalledWith(expect.anything(), 'bullet');
        ctrl!.setList('task');
        expect(spies.setBlockType).toHaveBeenLastCalledWith(expect.anything(), 'task', undefined, false);
        ctrl!.setList('none');
        expect(spies.setBlockType).toHaveBeenLastCalledWith(expect.anything(), 'paragraph');

        // Quote toggles off when the selection is already inside one.
        ctrl!.toggleQuote();
        expect(spies.setBlockType).toHaveBeenLastCalledWith(expect.anything(), 'blockquote');
        el._handlers.get('bindselection')!({
            type: 'selection',
            detail: { start: 0, end: 0, activeFormats: '', activeBlock: 'blockquote', caretX: 0, caretY: 0, caretHeight: 16 },
        });
        ctrl!.toggleQuote();
        expect(spies.setBlockType).toHaveBeenLastCalledWith(expect.anything(), 'paragraph');
    });

    it('insertLink wraps the selection, or inserts-then-links when collapsed', () => {
        let ctrl: MarkdownEditorController | null = null;
        const { container } = render(<MarkdownEditor value="" controllerRef={(c) => { ctrl = c; }} />);
        const el = container.findByType('sigx-richtext')!;

        // Non-empty selection → wrap it.
        el._handlers.get('bindselection')!({
            type: 'selection',
            detail: { start: 2, end: 6, activeFormats: '', activeBlock: 'paragraph', caretX: 0, caretY: 0, caretHeight: 16 },
        });
        ctrl!.insertLink('https://x.dev');
        expect(spies.applyFormat).toHaveBeenLastCalledWith(
            expect.anything(), 'link', 2, 6, { href: 'https://x.dev' },
        );
        expect(spies.insertText).not.toHaveBeenCalled();

        // Collapsed → insert the label, then link it.
        el._handlers.get('bindselection')!({
            type: 'selection',
            detail: { start: 4, end: 4, activeFormats: '', activeBlock: 'paragraph', caretX: 0, caretY: 0, caretHeight: 16 },
        });
        ctrl!.insertLink('https://x.dev', 'docs');
        expect(spies.insertText).toHaveBeenCalledWith(expect.anything(), 'docs');
        expect(spies.applyFormat).toHaveBeenLastCalledWith(
            expect.anything(), 'link', 4, 8, { href: 'https://x.dev' },
        );
    });

    it('feeds reported heights back as the element height (auto-grow)', async () => {
        const { container } = render(<MarkdownEditor value="" minLines={1} maxLines={4} />);
        const el = container.findByType('sigx-richtext')!;
        // 1 line @ 24 + 16 padding = 40 initial.
        expect(el._style.height).toBe(40);

        el._handlers.get('bindheightchange')!({
            type: 'heightchange',
            detail: { height: 88, lines: 3 },
        });
        await waitForUpdate();
        expect(container.findByType('sigx-richtext')!._style.height).toBe(88);
    });
    it('fixed mode pins a stable box at maxLines regardless of reported height', async () => {
        const { container } = render(<MarkdownEditor value="" minLines={1} maxLines={4} mode="fixed" />);
        const el = container.findByType('sigx-richtext')!;
        // 4 lines @ 24 + 16 padding = 112: min == max (internal scroll past it).
        expect(el._style.height).toBe(112);
        expect(el.props['min-height']).toBe(112);
        expect(el.props['max-height']).toBe(112);

        // A reported height (content shorter or longer) never moves the box.
        for (const height of [40, 112, 300]) {
            el._handlers.get('bindheightchange')!({
                type: 'heightchange',
                detail: { height, lines: 1 },
            });
            await waitForUpdate();
            expect(container.findByType('sigx-richtext')!._style.height).toBe(112);
        }
    });

    it('re-clamps height when the mode switches at runtime', async () => {
        const mode = signal<{ current: 'auto' | 'fixed' }>({ current: 'auto' });
        const Wrap = component(() => () => (
            <MarkdownEditor value="" minLines={1} maxLines={4} mode={mode.current} />
        ));
        const { container } = render(<Wrap />);
        expect(container.findByType('sigx-richtext')!._style.height).toBe(40);

        // auto → fixed: the box jumps to the pinned height and the native
        // element sees the new clamp props (it re-reports on prop change).
        mode.current = 'fixed';
        await waitForUpdate();
        const fixed = container.findByType('sigx-richtext')!;
        expect(fixed._style.height).toBe(112);
        expect(fixed.props['min-height']).toBe(112);

        // fixed → auto: back to the min until the native re-report arrives.
        mode.current = 'auto';
        await waitForUpdate();
        const auto = container.findByType('sigx-richtext')!;
        expect(auto._style.height).toBe(40);
        expect(auto.props['min-height']).toBe(40);
        expect(auto.props['max-height']).toBe(112);
    });

    it('openFullscreen restyles in place — same element, no document reset', async () => {
        let ctrl: MarkdownEditorController | null = null;
        const onFullscreenChange = vi.fn();
        const { container } = render(
            <MarkdownEditor
                value="# Hi"
                controllerRef={(c) => { ctrl = c; }}
                onFullscreenChange={onFullscreenChange}
                fullscreenClass="surface"
            />,
        );
        const before = container.findByType('sigx-richtext')!;
        expect(ctrl!.isFullscreen()).toBe(false);

        ctrl!.openFullscreen();
        await waitForUpdate();
        expect(ctrl!.isFullscreen()).toBe(true);
        expect(onFullscreenChange).toHaveBeenCalledWith(true);

        // The SAME mounted element — never re-parented/recreated (the native
        // doc would be lost: `value` is initial-only) and never re-seeded.
        const after = container.findByType('sigx-richtext')!;
        expect(after).toBe(before);
        expect(spies.setDocument).not.toHaveBeenCalled();
        // Overlay layout: fills instead of clamped height; unbounded max.
        expect(after._style.height).toBeUndefined();
        expect(after._style.flexGrow).toBe(1);
        expect(after.props['max-height']).toBe(0);
        // Root is an absolute-inset layer carrying the fullscreen class.
        const root = container.findAllByType('view').find((v) => v._style.position === 'fixed');
        expect(root).toBeTruthy();
        expect(root!.props['class']).toContain('surface');

        ctrl!.closeFullscreen();
        await waitForUpdate();
        expect(ctrl!.isFullscreen()).toBe(false);
        expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
        const restored = container.findByType('sigx-richtext')!;
        expect(restored).toBe(before);
        expect(restored._style.height).toBe(40);
        expect(container.findAllByType('view').some((v) => v._style.position === 'fixed')).toBe(false);
    });

    it('fullscreen shows a toolbar by default; explicit toolbar={false} suppresses it', async () => {
        let ctrl: MarkdownEditorController | null = null;
        const a = render(<MarkdownEditor value="" controllerRef={(c) => { ctrl = c; }} />);
        expect(a.container.findAllByType('text').some((t) => t.textContent() === 'B')).toBe(false);
        ctrl!.openFullscreen();
        await waitForUpdate();
        expect(a.container.findAllByType('text').some((t) => t.textContent() === 'B')).toBe(true);

        let ctrl2: MarkdownEditorController | null = null;
        const b = render(<MarkdownEditor value="" toolbar={false} controllerRef={(c) => { ctrl2 = c; }} />);
        ctrl2!.openFullscreen();
        await waitForUpdate();
        expect(b.container.findAllByType('text').some((t) => t.textContent() === 'B')).toBe(false);
    });

    // LAST in the file on purpose: seeding the core font-scale signal is a
    // module-level latch — once 1.5 lands, earlier tests' unscaled size
    // assertions (40/112) would see scaled values.
    it('scales fontSize and the derived auto-grow window by the OS font scale (#770)', async () => {
        (globalThis as { lynx?: unknown }).lynx = {
            __globalProps: { fontScale: { scale: 1.5, os: 1.5 } },
        };
        try {
            const { container } = render(<MarkdownEditor value="" />);
            const el = container.findByType('sigx-richtext')!;
            // 16 * 1.5 = 24; lineHeight 36; min 1*36+16; max 4*36+16.
            expect(el.props['editor-font-size']).toBe(24);
            expect(el.props['min-height']).toBe(52);
            expect(el.props['max-height']).toBe(160);
        } finally {
            delete (globalThis as { lynx?: unknown }).lynx;
        }
    });
});
