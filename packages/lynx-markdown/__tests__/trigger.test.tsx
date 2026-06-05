import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitForUpdate } from '@sigx/lynx-testing';
import { encodeDoc, RichTextMethods, type RichDoc } from '@sigx/lynx-richtext';
import { MarkdownEditor, type MarkdownEditorController } from '../src/editor/MarkdownEditor';
import { createTriggerSessionManager, type TriggerSession } from '../src/editor/trigger/session';
import { placeSuggestionPopup } from '../src/editor/trigger/position';
import type { MarkdownEditorPlugin, TriggerItem } from '../src/editor/plugin';

// ---------------------------------------------------------------------------
// Session manager (pure state machine — no rendering)
// ---------------------------------------------------------------------------

describe('trigger session manager', () => {
    const USERS: TriggerItem[] = [
        { id: 'u1', label: 'Andy' },
        { id: 'u2', label: 'Bea' },
    ];

    function makeManager(overrides: Partial<Parameters<typeof createTriggerSessionManager>[0]> = {}) {
        const updates: Array<TriggerSession | null> = [];
        const onQuery = vi.fn((q: string) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())));
        const manager = createTriggerSessionManager({
            triggers: [{ plugin: 'mention', spec: { char: '@', onQuery, onSelect: () => {} } }],
            onUpdate: (s) => updates.push(s),
            ...overrides,
        });
        return { manager, updates, onQuery };
    }

    it('opens on a trigger char at a boundary and tracks the query', () => {
        const { manager, onQuery } = makeManager();
        manager.syncText('hi @');
        manager.syncCaret(4);
        expect(manager.session).toMatchObject({ plugin: 'mention', anchor: 3, query: '' });

        manager.syncText('hi @an');
        manager.syncCaret(6);
        expect(manager.session).toMatchObject({ query: 'an', caret: 6 });
        expect(onQuery).toHaveBeenLastCalledWith('an');
        expect(manager.session!.items).toEqual([{ id: 'u1', label: 'Andy' }]);
    });

    it('does not open mid-word (no boundary before the trigger)', () => {
        const { manager } = makeManager();
        manager.syncText('email@');
        manager.syncCaret(6);
        expect(manager.session).toBeNull();
    });

    it('closes when whitespace breaks the run', () => {
        const { manager } = makeManager();
        manager.syncText('@an');
        manager.syncCaret(3);
        expect(manager.session).not.toBeNull();

        manager.syncText('@an ');
        manager.syncCaret(4);
        expect(manager.session).toBeNull();
    });

    it('closes when the caret leaves the run (or is not collapsed)', () => {
        const { manager } = makeManager();
        manager.syncText('@an tail');
        manager.syncCaret(3);
        expect(manager.session).not.toBeNull();

        manager.syncCaret(8); // caret after ' tail' — run no longer matches
        expect(manager.session).toBeNull();

        manager.syncCaret(3);
        expect(manager.session).not.toBeNull();
        manager.syncCaret(-1); // selection expanded
        expect(manager.session).toBeNull();
    });

    it('returns session snapshots — external mutation cannot desync state', () => {
        const { manager } = makeManager();
        manager.syncText('@a');
        manager.syncCaret(2);
        const snapshot = manager.session!;
        snapshot.items.push({ id: 'rogue', label: 'Rogue' });
        snapshot.query = 'mutated';
        expect(manager.session).toMatchObject({ query: 'a' });
        expect(manager.session!.items).toEqual([{ id: 'u1', label: 'Andy' }]);
    });

    it('closes on close() (blur / selection made)', () => {
        const { manager, updates } = makeManager();
        manager.syncText('@a');
        manager.syncCaret(2);
        manager.close();
        expect(manager.session).toBeNull();
        expect(updates[updates.length - 1]).toBeNull();
    });

    it('supports pattern triggers (multi-char prefix)', () => {
        const onQuery = vi.fn(() => [] as TriggerItem[]);
        const manager = createTriggerSessionManager({
            triggers: [{ plugin: 'cmd', spec: { pattern: /^::/, onQuery, onSelect: () => {} } }],
            onUpdate: () => {},
        });
        manager.syncText(':x');
        manager.syncCaret(2);
        expect(manager.session).toBeNull(); // single ':' is not the trigger

        manager.syncText('::sm');
        manager.syncCaret(4);
        expect(manager.session).toMatchObject({ plugin: 'cmd', anchor: 0, query: 'sm' });
    });

    it('matches g-flag patterns deterministically (lastIndex reset)', () => {
        const manager = createTriggerSessionManager({
            triggers: [{ plugin: 'cmd', spec: { pattern: /^::/g, onQuery: () => [], onSelect: () => {} } }],
            onUpdate: () => {},
        });
        // Without a lastIndex reset, the second exec on a g-flag regex would
        // start past the prefix and fail every other evaluation.
        for (let i = 0; i < 3; i++) {
            manager.syncText('::a');
            manager.syncCaret(3);
            expect(manager.session).not.toBeNull();
            manager.close();
        }
    });

    it('treats a throwing onQuery like a rejected query (loading cleared)', () => {
        const { manager } = makeManager({
            triggers: [{
                plugin: 'mention',
                spec: {
                    char: '@',
                    onQuery: () => {
                        throw new Error('plugin bug');
                    },
                    onSelect: () => {},
                },
            }],
        });
        manager.syncText('@a');
        manager.syncCaret(2);
        expect(manager.session).toMatchObject({ items: [], loading: false });
    });

    it('clears previous results when the query changes (no stale suggestions)', () => {
        const { manager } = makeManager();
        manager.syncText('@a');
        manager.syncCaret(2);
        expect(manager.session!.items).toHaveLength(1); // Andy

        // Async source for the next query: items must clear immediately.
        manager.syncText('@az');
        manager.syncCaret(3);
        expect(manager.session!.items).toEqual([]);
    });

    it('discards stale async results when a newer query supersedes them', async () => {
        const resolvers: Array<(items: TriggerItem[]) => void> = [];
        const onQuery = vi.fn(
            () => new Promise<TriggerItem[]>((resolve) => resolvers.push(resolve)),
        );
        const { manager } = makeManager({
            triggers: [{ plugin: 'mention', spec: { char: '@', onQuery, onSelect: () => {} } }],
        });

        manager.syncText('@a');
        manager.syncCaret(2);
        manager.syncText('@an');
        manager.syncCaret(3);
        expect(resolvers).toHaveLength(2);

        // The OLD query resolves last — its result must be discarded.
        resolvers[1]([{ id: 'u1', label: 'Andy' }]);
        resolvers[0]([{ id: 'zzz', label: 'Stale' }]);
        await Promise.resolve();

        expect(manager.session!.items).toEqual([{ id: 'u1', label: 'Andy' }]);
        expect(manager.session!.loading).toBe(false);
    });

    it('discards async results that resolve after the session closed', async () => {
        let resolveQuery!: (items: TriggerItem[]) => void;
        const onQuery = vi.fn(() => new Promise<TriggerItem[]>((r) => { resolveQuery = r; }));
        const { manager, updates } = makeManager({
            triggers: [{ plugin: 'mention', spec: { char: '@', onQuery, onSelect: () => {} } }],
        });

        manager.syncText('@a');
        manager.syncCaret(2);
        manager.close();
        resolveQuery([{ id: 'u1', label: 'Andy' }]);
        await Promise.resolve();

        expect(manager.session).toBeNull();
        expect(updates[updates.length - 1]).toBeNull();
    });

    it('debounces onQuery while typing fast', () => {
        vi.useFakeTimers();
        try {
            const onQuery = vi.fn(() => [] as TriggerItem[]);
            const { manager } = makeManager({
                triggers: [{ plugin: 'mention', spec: { char: '@', debounce: 50, onQuery, onSelect: () => {} } }],
            });
            manager.syncText('@a');
            manager.syncCaret(2);
            manager.syncText('@an');
            manager.syncCaret(3);
            expect(onQuery).not.toHaveBeenCalled();

            vi.advanceTimersByTime(60);
            expect(onQuery).toHaveBeenCalledTimes(1);
            expect(onQuery).toHaveBeenCalledWith('an');
        } finally {
            vi.useRealTimers();
        }
    });
});

// ---------------------------------------------------------------------------
// Popup placement (pure math)
// ---------------------------------------------------------------------------

describe('placeSuggestionPopup', () => {
    const base = {
        caretRect: { x: 30, y: 100, height: 18 },
        containerTop: 400,
        containerWidth: 320,
        containerHeight: 140,
        screenHeight: 800,
        keyboardHeight: 300,
        popupWidth: 240,
        maxPopupHeight: 220,
    };

    it('places above the caret by default (bottom-anchored)', () => {
        const pos = placeSuggestionPopup(base);
        expect(pos.placement).toBe('above');
        expect(pos.bottom).toBe(140 - 100 + 4);
        expect(pos.top).toBeUndefined();
    });

    it('flips below when there is no room above', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 4, height: 18 },
        });
        expect(pos.placement).toBe('below');
        expect(pos.top).toBe(4 + 18 + 4);
    });

    it('clamps maxHeight so the popup never extends under the keyboard', () => {
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 4, height: 18 },
            // keyboard top at 500; caret bottom at 22 → space below ≈ 474, clamp at maxPopupHeight
        });
        expect(pos.maxHeight).toBeLessThanOrEqual(base.maxPopupHeight);

        const tight = placeSuggestionPopup({
            ...base,
            containerTop: 350,
            caretRect: { x: 30, y: 10, height: 18 },
            screenHeight: 800,
            keyboardHeight: 380, // keyboard top at 420 — just below the caret
        });
        // 420 - (350+10+18) - 4 = 38 below; above has 350+10-4 = 356.
        expect(tight.placement).toBe('above');
        expect(tight.maxHeight).toBeLessThanOrEqual(base.maxPopupHeight);
    });

    it('never exceeds the available space, even below one row', () => {
        // Caret near the top of a screen-top container, keyboard nearly
        // covering everything: both sides are tight, above wins, and the
        // popup must shrink to the space rather than overflow.
        const pos = placeSuggestionPopup({
            ...base,
            containerTop: 0,
            caretRect: { x: 30, y: 20, height: 18 },
            screenHeight: 800,
            keyboardHeight: 770, // keyboard top at 30 — almost no room anywhere
        });
        expect(pos.placement).toBe('above');
        expect(pos.maxHeight).toBeLessThanOrEqual(20 - 4); // spaceAbove
    });

    it('clamps left so the popup stays inside the container', () => {
        const pos = placeSuggestionPopup({ ...base, caretRect: { x: 310, y: 100, height: 18 } });
        expect(pos.left).toBe(320 - 240);
    });
});

// ---------------------------------------------------------------------------
// Editor integration (synthetic element events)
// ---------------------------------------------------------------------------

const spies = {
    setSelectionRange: vi.spyOn(RichTextMethods, 'setSelectionRange'),
    insertText: vi.spyOn(RichTextMethods, 'insertText'),
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

/** The popup only renders once the input wrapper's frame is measured. */
function fireWrapperLayout(container: { findAllByType: (t: string) => Array<{ _handlers: Map<string, Function> }> }): void {
    const wrapper = container.findAllByType('view').find((v) => v._handlers.has('bindlayoutchange'))!;
    wrapper._handlers.get('bindlayoutchange')!({
        type: 'layoutchange',
        detail: { width: 320, height: 48, top: 400, left: 0, right: 320, bottom: 448 },
    });
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

const USERS: TriggerItem[] = [
    { id: 'u1', label: 'Andy' },
    { id: 'u2', label: 'Bea' },
];

function mentionTriggerPlugin(onSelectSpy = vi.fn()): { plugin: MarkdownEditorPlugin; onSelect: ReturnType<typeof vi.fn> } {
    const plugin: MarkdownEditorPlugin = {
        name: 'mention',
        trigger: {
            char: '@',
            onQuery: (q) => USERS.filter((u) => u.label.toLowerCase().startsWith(q.toLowerCase())),
            onSelect: (item, api) => {
                onSelectSpy(item);
                api.replaceQuery(`@[${item.label}](${item.id}) `);
            },
        },
    };
    return { plugin, onSelect: onSelectSpy };
}

describe('MarkdownEditor trigger sessions', () => {
    it('opens a session and shows the popup with ignore-focus', async () => {
        const { plugin } = mentionTriggerPlugin();
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('hi @an'));
        fireSelection(el, 6);
        await waitForUpdate();

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true);
        expect(popup).toBeTruthy();
        expect(popup!.findByText('Andy')).toBeTruthy();
    });

    it('replaces the trigger run on select and closes the popup', async () => {
        const { plugin, onSelect } = mentionTriggerPlugin();
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('hi @an'));
        fireSelection(el, 6);
        await waitForUpdate();

        const popup = container.findAllByType('view').find((v) => v.props['ignore-focus'] === true)!;
        const row = popup.findAllByType('view').find((v) => v._handlers.has('bindtap'))!;
        fireEvent.tap(row);
        await waitForUpdate();

        expect(onSelect).toHaveBeenCalledWith(USERS[0]);
        // replaceQuery = replaceRange(anchor=3, caret=6, …): select the run, insert over it.
        expect(spies.setSelectionRange).toHaveBeenCalledWith(expect.anything(), 3, 6);
        expect(spies.insertText).toHaveBeenCalledWith(expect.anything(), '@[Andy](u1) ');
        expect(container.findAllByType('view').some((v) => v.props['ignore-focus'] === true)).toBe(false);
    });

    it('closes the session on blur', async () => {
        const { plugin } = mentionTriggerPlugin();
        const { container } = render(<MarkdownEditor value="" plugins={[plugin]} />);
        const el = container.findByType('sigx-richtext')!;
        fireWrapperLayout(container);

        fireChange(el, doc('@a'));
        fireSelection(el, 2);
        await waitForUpdate();
        expect(container.findAllByType('view').some((v) => v.props['ignore-focus'] === true)).toBe(true);

        el._handlers.get('bindblur')!({ type: 'blur' });
        await waitForUpdate();
        expect(container.findAllByType('view').some((v) => v.props['ignore-focus'] === true)).toBe(false);
    });

    it('exposes replaceRange on the controller', () => {
        let ctrl: MarkdownEditorController | null = null;
        render(<MarkdownEditor value="" controllerRef={(c) => { ctrl = c; }} />);
        ctrl!.replaceRange(2, 5, 'x');
        expect(spies.setSelectionRange).toHaveBeenCalledWith(expect.anything(), 2, 5);
        expect(spies.insertText).toHaveBeenCalledWith(expect.anything(), 'x');
    });

    it('warns on duplicate inline plugin names / span types', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const inline = {
                syntax: { name: 'dup', triggerChars: ['@'] as const, match: () => null },
                serialize: () => '',
                docMapping: { spanType: 'mention' as const, toSpan: () => null },
            };
            render(
                <MarkdownEditor
                    value=""
                    plugins={[{ name: 'a', inline }, { name: 'b', inline }]}
                />,
            );
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate plugin syntax.name "dup"'));
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate plugin docMapping.spanType "mention"'));
        } finally {
            warn.mockRestore();
        }
    });

    it('appends plugin toolbar items after the defaults', () => {
        const run = vi.fn();
        const plugin: MarkdownEditorPlugin = {
            name: 'custom',
            toolbar: [{ id: 'zap', label: 'Zap', run }],
        };
        const { container } = render(<MarkdownEditor value="" toolbar plugins={[plugin]} />);
        const item = container.findByText('Zap');
        expect(item).toBeTruthy();
        // Defaults are still present before it.
        expect(container.findByText('B')).toBeTruthy();
    });
});
