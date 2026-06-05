import { describe, it, expect, vi, beforeEach } from 'vitest';

const pushOp = vi.fn();
const scheduleFlush = vi.fn();
vi.mock('@sigx/lynx', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    pushOp: (...args: unknown[]) => pushOp(...args),
    scheduleFlush: () => scheduleFlush(),
}));

const { OP } = await import('@sigx/lynx');
const { RichTextMethods } = await import('../src/methods');

const el = { id: 42 };

beforeEach(() => {
    pushOp.mockClear();
    scheduleFlush.mockClear();
});

describe('RichTextMethods.insertChip', () => {
    it('pushes INVOKE_UI_METHOD with the chip payload', () => {
        RichTextMethods.insertChip(el, { id: 'u1', label: 'Andy' });
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'insertChip', {
            id: 'u1',
            label: 'Andy',
        });
        expect(scheduleFlush).toHaveBeenCalled();
    });

    it('carries kind and the replace range when provided', () => {
        RichTextMethods.insertChip(el, { id: 'u1', label: 'Andy', kind: 'user' }, { from: 3, to: 6 });
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'insertChip', {
            id: 'u1',
            label: 'Andy',
            kind: 'user',
            replaceFrom: 3,
            replaceTo: 6,
        });
    });

    it('is a no-op without an element handle', () => {
        RichTextMethods.insertChip(null, { id: 'u1', label: 'Andy' });
        expect(pushOp).not.toHaveBeenCalled();
    });
});

describe('RichTextMethods.setBlockType', () => {
    it('omits absent level/checked and carries them when given', () => {
        RichTextMethods.setBlockType(el, 'bullet');
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'setBlockType', { type: 'bullet' });
        RichTextMethods.setBlockType(el, 'heading', 2);
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'setBlockType', { type: 'heading', level: 2 });
        RichTextMethods.setBlockType(el, 'task', undefined, false);
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'setBlockType', { type: 'task', checked: false });
    });
});

describe('RichTextMethods.applyFormat', () => {
    it('pushes the explicit range and attrs', () => {
        RichTextMethods.applyFormat(el, 'link', 3, 9, { href: 'https://x.dev' });
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'applyFormat', {
            type: 'link',
            start: 3,
            end: 9,
            attrs: { href: 'https://x.dev' },
        });
        expect(scheduleFlush).toHaveBeenCalled();
    });

    it('omits attrs when not given (unlink form is an explicit empty href)', () => {
        RichTextMethods.applyFormat(el, 'link', 3, 9);
        expect(pushOp).toHaveBeenCalledWith(OP.INVOKE_UI_METHOD, 42, 'applyFormat', {
            type: 'link',
            start: 3,
            end: 9,
        });
    });
});
