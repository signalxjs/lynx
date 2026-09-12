/**
 * `<MarkdownEditor>` end to end on the test renderer: fields per block,
 * typing through the fake element, Enter / Backspace across blocks, the
 * controller, external value writes, focus reporting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForUpdate } from '@sigx/lynx-testing';
import { decodeDoc } from '@sigx/lynx-richtext';
import { docOf, installFakeElement, isFocused, mountEditor, press, resetFakeElement, spies, tapAt, typeIn } from './editor/harness';

beforeEach(installFakeElement);
afterEach(resetFakeElement);

describe('MarkdownEditor', () => {
    it('renders one boundary-keys field per inline block, seeded with the block as a RichDoc', async () => {
        const m = await mountEditor({ value: '# Title\n\nSome **bold** text.\n\n- one\n- [ ] two\n\n---' });
        const fields = m.fields();
        // heading, paragraph, two list-item paragraphs
        expect(fields).toHaveLength(4);
        expect(fields.every((f) => f.props['boundary-keys'] === true)).toBe(true);
        const title = decodeDoc(fields[0].props['value'] as string);
        expect(title.text).toBe('Title');
        expect(title.blocks).toEqual([{ start: 0, end: 5, type: 'heading', level: 1 }]);
        const para = decodeDoc(fields[1].props['value'] as string);
        expect(para.spans).toEqual([{ start: 5, end: 9, type: 'bold' }]);
        // Markers and the checkbox come from the list views.
        expect(m.container.findByText('•')).toBeTruthy();
        expect(m.container.findByText('☐')).toBeTruthy();
        // Before any edit the markdown is the value as given.
        expect(m.controller.getMarkdown()).toBe('# Title\n\nSome **bold** text.\n\n- one\n- [ ] two\n\n---');
    });

    it('typing in a field reaches onChange as markdown without echoing back to the field', async () => {
        const onChange = vi.fn();
        const m = await mountEditor({ value: 'hello', onChange });
        const f = m.field(0);
        tapAt(f, 5);
        typeIn(f, '!');
        await waitForUpdate();
        expect(onChange).toHaveBeenLastCalledWith('hello!\n');
        expect(m.controller.getMarkdown()).toBe('hello!\n');
        // Own edits are never pushed back.
        expect(spies.setDocument).not.toHaveBeenCalled();
        expect(m.fields()).toHaveLength(1);
    });

    it('Enter splits into a new focused field and Backspace at its start joins back', async () => {
        const m = await mountEditor({ value: 'hello' });
        const f = m.field(0);
        tapAt(f, 2);
        press(f, 'Enter');
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('he\n\nllo\n');
        const fields = m.fields();
        expect(fields).toHaveLength(2);
        expect(docOf(fields[0]).text).toBe('he');
        expect(decodeDoc(fields[1].props['value'] as string).text).toBe('llo');
        expect(isFocused(fields[1])).toBe(true);
        expect(m.controller.getSelection()).toEqual({ mode: 'text', anchor: { key: 'b-1', offset: 0 }, head: { key: 'b-1', offset: 0 } });
        press(fields[1], 'Backspace');
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('hello\n');
        expect(m.fields()).toHaveLength(1);
        expect(docOf(m.field(0)).text).toBe('hello');
        expect(isFocused(m.field(0))).toBe(true);
    });

    it('input rules convert "# " into a heading and the field follows', async () => {
        const m = await mountEditor({ value: '' });
        const f = m.field(0);
        tapAt(f, 0);
        typeIn(f, '#');
        typeIn(f, ' ');
        await waitForUpdate();
        expect(m.controller.getDocument().children[0].type).toBe('heading');
        expect(docOf(m.field(0)).blocks[0]).toEqual({ start: 0, end: 0, type: 'heading', level: 1 });
        expect(docOf(m.field(0)).text).toBe('');
    });

    it('an external value replaces the document and ignores its own echo', async () => {
        const state = { md: 'one' };
        const m = await mountEditor({ value: state.md });
        expect(m.fields()).toHaveLength(1);
        // Re-render with a new value through the controller's setMarkdown (the prop path is the same watcher).
        m.controller.setMarkdown('# two\n\nthree');
        await waitForUpdate();
        expect(m.fields()).toHaveLength(2);
        // b-0 keeps its field (same key); the new content reached it through setDocument.
        expect(docOf(m.field(0)).blocks[0].type).toBe('heading');
        expect(docOf(m.field(0)).text).toBe('two');
        expect(m.controller.getMarkdown()).toBe('# two\n\nthree\n');
    });

    it('the controller formats, inserts chips, clears and reports focus', async () => {
        const onFocus = vi.fn();
        const onBlur = vi.fn();
        const m = await mountEditor({ value: 'hello world', onFocus, onBlur });
        const f = m.field(0);
        tapAt(f, 0, 5);
        expect(onFocus).toHaveBeenCalledTimes(1);
        m.controller.toggleBold();
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('**hello** world\n');
        // The element received the new content (marks as bold spans).
        expect(docOf(f).spans).toEqual([{ start: 0, end: 5, type: 'bold' }]);
        tapAt(f, 11);
        m.controller.insertChip({ id: 'u1', label: 'Andy' });
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('**hello** world@[Andy](u1)\n');
        expect(docOf(f).spans.at(-1)).toEqual({ start: 11, end: 12, type: 'mention', attrs: { id: 'u1', label: 'Andy', atom: 'mention' } });
        m.controller.setHeading(2);
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('## **hello** world@[Andy](u1)\n');
        m.controller.clear();
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('');
        m.controller.blur();
        expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it('disabled makes every field read-only and refuses boundary keys', async () => {
        const m = await mountEditor({ value: 'a\n\nb', disabled: true });
        expect(m.fields().every((f) => f.props['editable'] === false)).toBe(true);
        tapAt(m.field(1), 0);
        press(m.field(1), 'Backspace');
        await waitForUpdate();
        expect(m.fields()).toHaveLength(2);
    });
});
