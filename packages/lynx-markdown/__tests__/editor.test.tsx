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
});
