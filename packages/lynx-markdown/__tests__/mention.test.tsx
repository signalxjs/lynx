import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitForUpdate } from '@sigx/lynx-testing';
import { encodeDoc, RichTextMethods, type InlineSpan, type RichDoc } from '@sigx/lynx-richtext';
import { MarkdownEditor, type MarkdownEditorController } from '../src/editor/MarkdownEditor';
import { createMentionPlugin, mentionSyntax } from '../src/plugins/mention';
import { mdToDoc } from '../src/editor/convert/mdToDoc';
import { docToMd } from '../src/editor/convert/docToMd';
import type { MentionCandidate } from '../src/plugins/mention';

const USERS: MentionCandidate[] = [
    { id: 'u1', label: 'Andy', kind: 'user' },
    { id: 'u2', label: 'Bea' },
];

const search = (q: string) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase()));

// ---------------------------------------------------------------------------
// Parser syntax
// ---------------------------------------------------------------------------

describe('mentionSyntax', () => {
    it('matches @[label](id) and returns null on partial tails', () => {
        const m = mentionSyntax.match('hi @[Andy](u1)!', 3);
        expect(m).toMatchObject({
            node: { type: 'extension', name: 'mention', attrs: { label: 'Andy', id: 'u1' }, raw: '@[Andy](u1)' },
            end: 14,
        });
        expect(mentionSyntax.match('hi @[An', 3)).toBeNull();
        expect(mentionSyntax.match('hi @[Andy](', 3)).toBeNull();
        expect(mentionSyntax.match('hi @plain', 3)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Conversion (doc mapping + serialization)
// ---------------------------------------------------------------------------

describe('mention plugin conversion', () => {
    const plugin = createMentionPlugin({ search });
    const inOpts = {
        extensions: [plugin.inline!.syntax],
        spanMappers: { mention: plugin.inline!.docMapping.toSpan },
    };
    const outOpts = {
        serializers: new Map([[
            'mention',
            (span: InlineSpan, text: string) => plugin.inline!.serialize(span, text),
        ]]),
    };

    it('maps @[label](id) onto a single U+FFFC with attrs (chip invariant)', () => {
        const doc = mdToDoc('hi @[Andy](u1)!', 0, inOpts);
        expect(doc.text).toBe('hi \uFFFC!');
        expect(doc.spans).toEqual([
            { start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy' } },
        ]);
    });

    it('serializes the chip back from attrs (covered text is the U+FFFC)', () => {
        const doc = mdToDoc('hi @[Andy](u1)!', 0, inOpts);
        expect(docToMd(doc, outOpts)).toBe('hi @[Andy](u1)!');
    });

    it('round-trips a chip wrapped in formatting', () => {
        const md = '**ping @[Bea](u2) now**';
        const doc = mdToDoc(md, 0, inOpts);
        expect(doc.text).toBe('ping \uFFFC now');
        expect(docToMd(doc, outOpts)).toBe(md);
    });

    it('strips forbidden characters from labels/ids on serialize (v1 rule)', () => {
        const out = plugin.inline!.serialize(
            { start: 0, end: 1, type: 'mention', attrs: { id: 'u)1', label: 'An]dy' } },
            '\uFFFC',
        );
        expect(out).toBe('@[Andy](u1)');
    });
});

// ---------------------------------------------------------------------------
// Editor integration: @ trigger → popup → insertChip
// ---------------------------------------------------------------------------

const spies = {
    insertChip: vi.spyOn(RichTextMethods, 'insertChip'),
};

beforeEach(() => {
    for (const spy of Object.values(spies)) spy.mockClear().mockImplementation(() => {});
});
afterEach(() => {
    for (const spy of Object.values(spies)) spy.mockReset();
});

function doc(text: string, v = 1): RichDoc {
    return { text, spans: [], blocks: [], v };
}

function fireChange(el: { _handlers: Map<string, Function> }, d: RichDoc): void {
    el._handlers.get('bindchange')!({ type: 'change', detail: { doc: encodeDoc(d), isComposing: false } });
}

function fireSelection(el: { _handlers: Map<string, Function> }, caret: number): void {
    el._handlers.get('bindselection')!({
        type: 'selection',
        detail: {
            start: caret,
            end: caret,
            activeFormats: '',
            activeBlock: 'paragraph',
            caretX: 12,
            caretY: 6,
            caretHeight: 18,
        },
    });
}

function fireWrapperLayout(container: { findAllByType: (t: string) => Array<{ _handlers: Map<string, Function> }> }): void {
    const wrapper = container.findAllByType('view').find((v) => v._handlers.has('bindlayoutchange'))!;
    wrapper._handlers.get('bindlayoutchange')!({
        type: 'layoutchange',
        detail: { width: 320, height: 48, top: 400, left: 0, right: 320, bottom: 448 },
    });
}

describe('mention plugin in MarkdownEditor', () => {
    it('selecting a suggestion inserts a chip over the trigger run', async () => {
        const plugin = createMentionPlugin({ search });
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('cc @an'));
        fireSelection(el, 6);
        await waitForUpdate();

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true)!;
        expect(popup.findByText('Andy')).toBeTruthy();

        const row = popup.findAllByType('view').find((v) => v._handlers.has('bindtap'))!;
        fireEvent.tap(row);
        await waitForUpdate();

        expect(spies.insertChip).toHaveBeenCalledWith(
            expect.anything(),
            { id: 'u1', label: 'Andy', kind: 'user' },
            { from: 3, to: 6 },
        );
        // Session closed → popup gone.
        expect(container.findAllByType('view').some((v) => v.props['ignore-focus'] === true)).toBe(false);
    });

    it('controller.insertChip forwards to the native method', () => {
        let ctrl: MarkdownEditorController | null = null;
        render(<MarkdownEditor value="" controllerRef={(c) => { ctrl = c; }} />);
        ctrl!.insertChip({ id: 'u2', label: 'Bea' }, { from: 1, to: 4 });
        expect(spies.insertChip).toHaveBeenCalledWith(
            expect.anything(),
            { id: 'u2', label: 'Bea' },
            { from: 1, to: 4 },
        );
    });

    it('supports async search sources', async () => {
        const plugin = createMentionPlugin({
            search: async (q) => search(q),
        });
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('@b'));
        fireSelection(el, 2);
        await waitForUpdate();
        await waitForUpdate(); // async search resolution

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true);
        expect(popup).toBeTruthy();
        expect(popup!.findByText('Bea')).toBeTruthy();
    });
});
