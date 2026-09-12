/**
 * The mention plugin: the `@[label](id)` syntax (from `@sigx/markdown`), the
 * label rule at every boundary, and the editor half — `@` sessions, chip
 * insertion through the field, round-trips.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, waitForUpdate, type TestNode } from '@sigx/lynx-testing';
import { parseMarkdown, toMarkdown, type InlineMatchContext } from '@sigx/markdown';
import { createMentionPlugin, mentionPlugin, mentionSyntax } from '../src/plugins/mention';
import type { MentionCandidate } from '../src/plugins/mention';
import { docOf, installFakeElement, layoutFields, mountEditor, resetFakeElement, tapAt, typeIn } from './editor/harness';

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
        expect(toMarkdown(parseMarkdown(md, { plugins: [plugin] }), { plugins: [plugin] })).toBe(md + '\n');
    });

    it('carries the syntax and serializer as one @sigx/markdown plugin', () => {
        expect(mentionPlugin.inline).toContain(mentionSyntax);
        expect(mentionPlugin.serialize!.mention({ type: 'mention', id: 'u1', label: 'Andy' }, {} as never)).toBe('@[Andy](u1)');
    });
});

// ---------------------------------------------------------------------------
// In the editor
// ---------------------------------------------------------------------------

beforeEach(installFakeElement);
afterEach(resetFakeElement);

type ViewNode = TestNode;
const popupOf = (container: { findAllByType: (t: string) => ViewNode[] }): ViewNode | null =>
    container.findAllByType('view').find((v) => v.props['ignore-focus'] === true && v.props['accessibility-label'] === undefined) ?? null;
const rowOf = (popup: ViewNode, label: string): ViewNode => popup.findAllByType('view').find((v) => v._handlers.has('bindtap') && v.findByText(label))!;

const CHIP = '￼';

describe('mention plugin in MarkdownEditor', () => {
    it('selecting a suggestion inserts a chip over the trigger run, serialized as @[label](id)', async () => {
        const m = await mountEditor({ value: 'cc', plugins: [createMentionPlugin({ search })] });
        const f = m.field(0);
        layoutFields(m.container);
        tapAt(f, 2);
        typeIn(f, ' @an');
        await waitForUpdate();
        const popup = popupOf(m.container)!;
        expect(popup.findByText('Andy')).toBeTruthy();
        fireEvent.tap(rowOf(popup, 'Andy'));
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('cc @[Andy](u1)\n');
        // The field got the chip: one U+FFFC under a mention span carrying id, label and kind.
        const doc = docOf(f);
        expect(doc.text).toBe(`cc ${CHIP} `);
        expect(doc.spans).toEqual([{ start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy', kind: 'user', atom: 'mention' } }]);
        expect(popupOf(m.container)).toBeNull();
    });

    it('sanitizes candidate labels/ids at the trigger boundary and drops empties (label rule)', async () => {
        const plugin = createMentionPlugin({ search: () => [{ id: 'u)1', label: 'An]dy' }, { id: ')', label: ']' }] });
        const m = await mountEditor({ value: '', plugins: [plugin] });
        const f = m.field(0);
        layoutFields(m.container);
        tapAt(f, 0);
        typeIn(f, '@a');
        await waitForUpdate();
        const popup = popupOf(m.container)!;
        expect(popup.findByText('Andy')).toBeTruthy();
        expect(popup.findAllByType('view').filter((v) => v._handlers.has('bindtap'))).toHaveLength(1);
        fireEvent.tap(rowOf(popup, 'Andy'));
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('@[Andy](u1)\n');
    });

    it('controller.insertChip inserts a mention atom, optionally replacing a range', async () => {
        const m = await mountEditor({ value: 'hi' });
        tapAt(m.field(0), 2);
        m.controller.insertChip({ id: 'u1', label: 'Andy', kind: 'user' }, { from: 0, to: 2 });
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('@[Andy](u1)\n');
    });

    it('carries extra candidate fields through to renderItem (rich rows)', async () => {
        const plugin = createMentionPlugin({
            search: () => [{ id: 'u)1', label: 'An]dy', avatar: 'a.png' }],
            renderItem: (item) => (
                <view>
                    <text>{String((item as { avatar?: string }).avatar)}</text>
                    <text>{item.label}</text>
                </view>
            ),
        });
        const m = await mountEditor({ value: '', plugins: [plugin] });
        layoutFields(m.container);
        tapAt(m.field(0), 0);
        typeIn(m.field(0), '@a');
        await waitForUpdate();
        const popup = popupOf(m.container)!;
        expect(popup.findByText('a.png')).toBeTruthy();
        expect(popup.findByText('Andy')).toBeTruthy();
    });

    it('supports async search sources', async () => {
        const m = await mountEditor({ value: '', plugins: [createMentionPlugin({ search: async (q) => search(q) })] });
        layoutFields(m.container);
        tapAt(m.field(0), 0);
        typeIn(m.field(0), '@b');
        await waitForUpdate();
        await waitForUpdate();
        expect(popupOf(m.container)!.findByText('Bea')).toBeTruthy();
    });

    it('a mention in the initial markdown mounts as a chip and round-trips', async () => {
        const m = await mountEditor({ value: 'hi @[Andy](u1)!', plugins: [createMentionPlugin({ search })] });
        const doc = docOf(m.field(0));
        expect(doc.text).toBe(`hi ${CHIP}!`);
        expect(doc.spans[0]).toEqual({ start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy', atom: 'mention' } });
        tapAt(m.field(0), 5);
        typeIn(m.field(0), '?');
        await waitForUpdate();
        expect(m.controller.getMarkdown()).toBe('hi @[Andy](u1)!?\n');
    });
});
