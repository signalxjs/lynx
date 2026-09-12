import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitForUpdate } from '@sigx/lynx-testing';
import { encodeDoc, RichTextMethods, type InlineSpan, type RichDoc } from '@sigx/lynx-richtext';
import { MarkdownEditor, type MarkdownEditorController } from '../src/editor/MarkdownEditor';
import { createMentionPlugin, mentionPlugin, mentionSyntax } from '../src/plugins/mention';
import { mdToDoc } from '../src/editor/convert/mdToDoc';
import { docToMd } from '../src/editor/convert/docToMd';
import type { MentionCandidate } from '../src/plugins/mention';
import type { InlineMatchContext } from '@sigx/markdown';

/** A bare match context — no positions, no nested inline parsing. */
const ctx: InlineMatchContext = { parseInline: () => [], position: () => undefined };

const USERS: MentionCandidate[] = [
    { id: 'u1', label: 'Andy', kind: 'user' },
    { id: 'u2', label: 'Bea' },
];

const search = (q: string) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase()));

// ---------------------------------------------------------------------------
// Parser syntax
// ---------------------------------------------------------------------------

describe('mentionSyntax (re-exported from @sigx/markdown)', () => {
    it('matches @[label](id) into a mention node and returns null on partial tails', () => {
        const m = mentionSyntax.match('hi @[Andy](u1)!', 3, ctx);
        expect(m).toEqual({ node: { type: 'mention', label: 'Andy', id: 'u1' }, end: 14 });
        expect(mentionSyntax.match('hi @[An', 3, ctx)).toBeNull();
        expect(mentionSyntax.match('hi @[Andy](', 3, ctx)).toBeNull();
        expect(mentionSyntax.match('hi @plain', 3, ctx)).toBeNull();
    });

    it('refuses exactly what the serializer strips (parser/serializer symmetry)', () => {
        // A label cannot hold `]`, an id cannot hold `)`, neither a CR/LF —
        // the write path cleans the same set, so round-trips never mutate.
        expect(mentionSyntax.match('@[An]dy](u1)', 0, ctx)).toBeNull();
        expect(mentionSyntax.match('@[An\rdy](u1)', 0, ctx)).toBeNull();
        expect(mentionSyntax.match('@[Andy](u\n1)', 0, ctx)).toBeNull();
        // `)` in a label and `]` in an id are fine on both sides.
        const plugin = createMentionPlugin({ search: () => [] });
        const md = '@[Smith (Bob)](u]1)';
        expect(mentionSyntax.match(md, 0, ctx)).toEqual({
            node: { type: 'mention', label: 'Smith (Bob)', id: 'u]1' },
            end: md.length,
        });
        expect(plugin.inline!.serialize(
            { start: 0, end: 1, type: 'mention', attrs: { id: 'u]1', label: 'Smith (Bob)' } },
            '\uFFFC',
        )).toBe(md);
    });

    it('carries the syntax and serializer as one @sigx/markdown plugin', () => {
        expect(mentionPlugin.inline).toContain(mentionSyntax);
        expect(mentionPlugin.serialize!.mention({ type: 'mention', id: 'u1', label: 'Andy' }, {} as never)).toBe('@[Andy](u1)');
    });
});

// ---------------------------------------------------------------------------
// Conversion (doc mapping + serialization)
// ---------------------------------------------------------------------------

describe('mention plugin conversion', () => {
    const plugin = createMentionPlugin({ search });
    const inOpts = {
        plugins: [mentionPlugin],
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

    it('degrades malformed spans to the plain label instead of @[]()', () => {
        expect(plugin.inline!.serialize(
            { start: 0, end: 1, type: 'mention', attrs: { label: 'Andy' } },
            '\uFFFC',
        )).toBe('Andy');
        expect(plugin.inline!.serialize(
            { start: 0, end: 1, type: 'mention' },
            '\uFFFC',
        )).toBe('');
    });

    it('strips forbidden characters from labels/ids on serialize (label rule)', () => {
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

    it('sanitizes candidate labels/ids at the trigger boundary (label rule)', async () => {
        const plugin = createMentionPlugin({
            search: () => [{ id: 'u)1', label: 'An]dy' }],
        });
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('@a'));
        fireSelection(el, 2);
        await waitForUpdate();

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true)!;
        // The popup shows the cleaned label — what the chip will carry.
        expect(popup.findByText('Andy')).toBeTruthy();
        const row = popup.findAllByType('view').find((v) => v._handlers.has('bindtap'))!;
        fireEvent.tap(row);

        expect(spies.insertChip).toHaveBeenCalledWith(
            expect.anything(),
            { id: 'u1', label: 'Andy' },
            { from: 0, to: 2 },
        );
    });

    it('drops candidates that clean to an empty id/label', async () => {
        const plugin = createMentionPlugin({
            search: () => [
                { id: '))', label: 'Ghost' }, // id cleans to '' — never offered
                { id: 'u2', label: 'Bea' },
            ],
        });
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('@'));
        fireSelection(el, 1);
        await waitForUpdate();

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true)!;
        expect(popup.findByText('Bea')).toBeTruthy();
        expect(popup.findByText('Ghost')).toBeFalsy();
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

    it('carries extra candidate fields through to renderItem (rich rows)', async () => {
        const plugin = createMentionPlugin({
            // A candidate with a display-only `avatar` beyond id/label.
            search: () => [{ id: 'u)1', label: 'An]dy', avatar: 'a.png' }],
            // renderItem reads the passthrough field — proves it survived toItems.
            renderItem: (item) => (
                <view>
                    <text>{String((item as { avatar?: string }).avatar)}</text>
                    <text>{item.label}</text>
                </view>
            ),
        });
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('@a'));
        fireSelection(el, 2);
        await waitForUpdate();

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true)!;
        // The extra field reached the row…
        expect(popup.findByText('a.png')).toBeTruthy();
        // …while id/label were still cleaned to the label rule.
        expect(popup.findByText('Andy')).toBeTruthy();
        const row = popup.findAllByType('view').find((v) => v._handlers.has('bindtap'))!;
        fireEvent.tap(row);
        expect(spies.insertChip).toHaveBeenCalledWith(
            expect.anything(),
            { id: 'u1', label: 'Andy' },
            { from: 0, to: 2 },
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
