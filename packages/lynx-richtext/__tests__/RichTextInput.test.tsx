import { describe, it, expect, vi } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { RichTextInput } from '../src/RichTextInput';
import { RichTextMethods } from '../src/methods';
import { encodeDoc, emptyDoc } from '../src/model/codec';
import type { RichDoc, SelectionState } from '../src/model/types';

const doc: RichDoc = {
    text: 'hi bold',
    spans: [{ start: 3, end: 7, type: 'bold' }],
    blocks: [],
    v: 1,
};

describe('RichTextInput', () => {
    it('renders the native intrinsic with mapped kebab-case attrs', () => {
        const { container } = render(
            <RichTextInput
                value={doc}
                placeholder="Say something"
                minHeight={40}
                maxHeight={160}
                fontSize={16}
                confirmType="send"
            />,
        );
        const el = container.findByType('sigx-richtext');
        expect(el).toBeTruthy();
        expect(el!.props['value']).toBe(JSON.stringify(doc));
        expect(el!.props['placeholder']).toBe('Say something');
        expect(el!.props['min-height']).toBe(40);
        expect(el!.props['max-height']).toBe(160);
        expect(el!.props['editor-font-size']).toBe(16);
        expect(el!.props['confirm-type']).toBe('send');
    });

    it('decodes bindchange payloads into RichDoc for onChange', () => {
        const onChange = vi.fn();
        const { container } = render(<RichTextInput onChange={onChange} />);
        const el = container.findByType('sigx-richtext')!;
        const handler = el._handlers.get('bindchange')!;
        handler({ type: 'change', detail: { doc: encodeDoc(doc), isComposing: false } });
        expect(onChange).toHaveBeenCalledTimes(1);
        const [decoded, composing] = onChange.mock.calls[0];
        expect(decoded).toEqual(doc);
        expect(composing).toBe(false);
    });

    it('parses bindselection into a SelectionState', () => {
        let sel: SelectionState | null = null;
        const { container } = render(<RichTextInput onSelection={(s) => { sel = s; }} />);
        const el = container.findByType('sigx-richtext')!;
        el._handlers.get('bindselection')!({
            type: 'selection',
            detail: {
                start: 2, end: 5, activeFormats: 'bold,italic', activeBlock: 'heading',
                headingLevel: 2, caretX: 10, caretY: 20, caretHeight: 18,
            },
        });
        expect(sel).toEqual({
            start: 2,
            end: 5,
            activeFormats: ['bold', 'italic'],
            activeBlock: 'heading',
            headingLevel: 2,
            caretRect: { x: 10, y: 20, height: 18 },
        });
    });

    it('delivers the element handle via onElement', () => {
        let handle: unknown;
        const { container } = render(<RichTextInput onElement={(el) => { handle = el; }} />);
        expect(handle).toBeTruthy();
        // In tests the handle is the TestNode itself; on-device it's the BG
        // ShadowElement (whose `.id` feeds RichTextMethods' invoke op).
        expect(handle).toBe(container.findByType('sigx-richtext'));
    });
});

describe('RichTextMethods', () => {
    it('no-ops on a null handle without throwing', () => {
        expect(() => {
            RichTextMethods.toggleFormat(null, 'bold');
            RichTextMethods.setDocument(undefined, emptyDoc());
            RichTextMethods.focus(null);
        }).not.toThrow();
    });
});
