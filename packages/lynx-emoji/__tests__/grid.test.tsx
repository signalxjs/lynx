import { describe, it, expect, vi } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, getAllByType, getByType, getByText, queryByText, act } from '@sigx/lynx-testing';
import { EmojiGrid, sectionRowIndex, sectionStartOffsets } from '../src/components/EmojiGrid';
import { emojiRowPx } from '../src/components/EmojiCell';
import { HEADER_PX } from '../src/components/SectionHeader';
import { EmojiPicker } from '../src/components/EmojiPicker';
import type { EmojiData, EmojiDatum } from '../src/data/schema';

// The skin-tone popover still renders <Pressable> (an MT gesture recognizer
// the BG test harness can't drive) — swap it for a plain view so popover
// cells are tappable. Grid cells no longer use Pressable at all (#649):
// they are <list-item> templates with native bindtap/bindlongpress.
vi.mock('@sigx/lynx-gestures', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx-gestures')>();
    const { component } = await import('@sigx/lynx');
    const { jsx } = await import('@sigx/lynx/jsx-runtime');
    const Pressable = (component as (setup: (ctx: never) => () => unknown) => unknown)(
        (({ props, slots, emit }: { props: Record<string, unknown>; slots: { default?: () => unknown }; emit: (e: string) => void }) => () =>
            jsx('view', {
                class: props.class,
                bindtap: () => emit('press'),
                bindlongpress: () => emit('longPress'),
                children: slots.default?.() as never,
            })) as never,
    );
    return { ...actual, Pressable };
});

const makeEmojis = (prefix: string, n: number, c: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({
        e: `${prefix}${i}`,
        n: `${prefix} ${i}`,
        c,
        o: c * 1000 + i,
        // Give the first emoji tone variants so a long-press opens the popover.
        ...(i === 0 ? { s: [1, 2, 3, 4, 5].map((t) => `${prefix}0~${t}`) } : {}),
    }));

// Two categories sized like the real extremes (388 mirrors smileys-emotion).
const CAT_A = makeEmojis('A', 388, 0);
const CAT_B = makeEmojis('B', 50, 1);

const makeData = (): EmojiData => ({
    locale: 'en',
    categories: [
        { key: 'cat-a', label: 'category a' },
        { key: 'cat-b', label: 'category b' },
    ],
    emojis: [...CAT_A, ...CAT_B],
    skinTones: ['light', 'medium-light', 'medium', 'medium-dark', 'dark'],
});

type TestNode = {
    _handlers: Map<string, (e?: unknown) => void>;
    children: TestNode[];
    textContent(): string;
};

/**
 * Deepest node with the given handler whose subtree contains the text —
 * post-order, so children win over ancestors and the first deepest match
 * is returned deterministically.
 */
function findByHandler(root: TestNode, handler: string, text: string): TestNode | null {
    for (const child of root.children) {
        const hit = findByHandler(child, handler, text);
        if (hit) return hit;
    }
    return root._handlers.has(handler) && root.textContent().includes(text) ? root : null;
}

/**
 * The sectioned grid mounts only after (a) `ctx.ready` (persisted
 * recents/tone hydrated — microtasks, flushed by act) and (b) the grid
 * region reporting a measured height (#666: mounting earlier meant a
 * full ~1,900-row re-render per late arrival). The fake renderer never
 * fires layout events, so drive the region's bindlayoutchange by hand.
 */
async function measureRegion(container: unknown): Promise<void> {
    const fire = (n: TestNode): boolean => {
        const h = n._handlers.get('bindlayoutchange');
        if (h) {
            h({ detail: { width: 400, height: 600, top: 0, left: 0 } });
            return true;
        }
        return n.children.some(fire);
    };
    await act(() => { fire(container as TestNode); });
    // `ctx.ready` flips after the persistence seam's guarded dynamic import
    // settles — a macrotask or two in vitest, not just microtasks. Then the
    // sectioned grid STAGES rows in zero-delay chunks (#666), so also poll
    // until the mounted row count stops growing.
    let last = -1;
    for (let i = 0; i < 40; i++) {
        const count = getAllByType(container as never, 'list-item').length;
        if (count > 0 && count === last) return;
        last = count;
        await new Promise((r) => setTimeout(r, 0));
        await act(() => { fire(container as TestNode); });
    }
}

describe('EmojiGrid (template cells, #649)', () => {
    it('renders every cell of a big category — no windowing', () => {
        const { container } = render(<EmojiGrid emojis={CAT_A} />);
        const cells = getAllByType(container, 'list-item');
        expect(cells.length).toBe(CAT_A.length); // all 388 — staged rows are cheap
        // Platform attrs come from the cell's own JSX now (not List props).
        expect(cells[0].props['item-key']).toBe('A0');
        // Default cell estimate: 6+6px padding + 32px glyph at ~1.2 line-height.
        expect(cells[0].props['estimated-main-axis-size-px']).toBe(50);
        // Native reuse group — parity with the pre-template itemType wrapper.
        expect(cells[0].props['item-type']).toBe('emoji');
        // The glyph is a `text` ATTRIBUTE (keeps the template slot-free).
        const textEl = cells[0].children.find((c: { type?: string }) => (c as { type: string }).type === 'text') as
            | { props: Record<string, unknown> }
            | undefined;
        expect(textEl?.props['text']).toBe('A0');
    });

    it('passes columns through as span-count on a flow list', () => {
        const { container } = render(<EmojiGrid emojis={CAT_A} columns={4} />);
        const list = getAllByType(container, 'list')[0];
        expect(list.props['span-count']).toBe(4);
        expect(list.props['list-type']).toBe('flow');
        expect(getAllByType(container, 'list-item').length).toBe(CAT_A.length);
    });

    it('itemsKey swap re-anchors the grid to the new dataset', async () => {
        const state = signal<{ emojis: EmojiDatum[]; key: string }>({ emojis: CAT_A, key: 't:cat-a' });
        const Harness = component(() => () => (
            <EmojiGrid emojis={state.emojis} itemsKey={state.key} />
        ));
        const { container } = render(<Harness />);
        await act(() => {});
        expect(getAllByType(container, 'list-item')[0].props['item-key']).toBe('A0');
        await act(() => { state.$set({ emojis: CAT_B, key: 't:cat-b' }); });
        const cells = getAllByType(container, 'list-item');
        expect(cells.length).toBe(CAT_B.length);
        expect(cells[0].props['item-key']).toBe('B0');
    });

    it('emits pick on tap and pickTone on long-press of a tonal cell', async () => {
        const picked: string[] = [];
        const toned: string[] = [];
        const Harness = component(() => () => (
            <EmojiGrid
                emojis={CAT_B}
                onPick={(d) => picked.push(d.e)}
                onPickTone={(d) => toned.push(d.e)}
            />
        ));
        const { container } = render(<Harness />);
        await act(() => {});
        const cells = getAllByType(container, 'list-item') as unknown as TestNode[];
        await act(() => { cells[1]._handlers.get('bindtap')!(); });
        expect(picked).toEqual(['B1']);
        // B0 is tonal → pickTone; B1 is not → no event.
        await act(() => { cells[0]._handlers.get('bindlongpress')!(); });
        await act(() => { cells[1]._handlers.get('bindlongpress')!(); });
        expect(toned).toEqual(['B0']);
    });
});

describe('EmojiPicker (template grid integration)', () => {
    // Tab swaps are single-phase now (#649 removed the deferred two-phase
    // swap — staging template rows is cheap). Tabs live in the tab bar's
    // scroll-view; grid cells can contain the same glyph text once mounted.
    async function tapTab(container: unknown, glyph: string): Promise<void> {
        const bar = getByType(container as never, 'scroll-view');
        const tabNode = findByHandler(bar as never, 'bindtap', glyph);
        expect(tabNode).toBeTruthy();
        await act(() => { tabNode!._handlers.get('bindtap')!(); });
    }

    it('renders ONE sectioned list — a tab tap scrolls, nothing re-mounts (#662)', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} />,
        );
        await measureRegion(container);
        const rows = getAllByType(container, 'list-item');
        // Every category in one list, plus one sticky header per section.
        expect(rows.length).toBe(CAT_A.length + CAT_B.length + 2);
        const headers = rows.filter((r) => r.props['item-type'] === 'emoji-header');
        expect(headers.map((h) => h.props['item-key'])).toEqual(['hdr:cat-a', 'hdr:cat-b']);
        expect(headers[0].props['full-span']).toBe(true);
        expect(headers[0].props['sticky-top']).toBe(true);
        // Cell keys are section-prefixed (recents can repeat a category's emoji).
        const keys = rows.map((c) => c.props['item-key'] as string);
        expect(keys).toContain('cat-a:A0');
        expect(keys).toContain('cat-b:B0');
        // A tab tap scrolls natively — the mounted row set does not change.
        await tapTab(container, 'B0');
        const after = getAllByType(container, 'list-item');
        expect(after.length).toBe(rows.length);
        expect(after.map((c) => c.props['item-key'] as string)).toContain('cat-a:A0');
    });

    it('opening the skin-tone popover does not rebuild the grid cells', async () => {
        // Prefix the cell text so the long-press target can't collide with the
        // tab bar (tab 'cat-a' falls back to the same 'A0' glyph).
        const renderCell = vi.fn((d: EmojiDatum, glyph: string) => <text>{`cell:${glyph}`}</text>);
        const { container } = render(
            <EmojiPicker
                data={makeData()}
                showSearch={false}
                showRecents={false}
                renderCell={renderCell}
            />,
        );
        await measureRegion(container);
        expect(renderCell).toHaveBeenCalledTimes(CAT_A.length + CAT_B.length);
        renderCell.mockClear();
        // Long-press the tonal 'A0' cell → the popover opens…
        const cell = findByHandler(container as never, 'bindlongpress', 'cell:A0');
        expect(cell).toBeTruthy();
        await act(() => { cell!._handlers.get('bindlongpress')!(); });
        expect(getByText(container, 'A0~1')).toBeTruthy();
        // …and the mounted grid was left untouched: no cell re-rendered.
        expect(renderCell).not.toHaveBeenCalled();
    });

    it('long-press on a non-tonal emoji does not open the popover', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} />,
        );
        await measureRegion(container);
        // Default cells carry the glyph as a `text` ATTRIBUTE (slot-free
        // template), so find the cell by item-key rather than subtree text.
        const cell = getAllByType(container, 'list-item')
            .find((c) => c.props['item-key'] === 'cat-a:A1') as unknown as TestNode;
        expect(cell).toBeTruthy();
        await act(() => { cell._handlers.get('bindlongpress')!(); });
        expect(queryByText(container, 'A1~1')).toBeNull();
    });
});

describe('sectioned grid (#662)', () => {
    const SECTIONS = [
        { key: 'cat-a', label: 'category a', emojis: CAT_A },
        { key: 'cat-b', label: 'category b', emojis: CAT_B },
    ];

    it('sectionRowIndex maps a key to its header cell index', () => {
        expect(sectionRowIndex(SECTIONS, 'cat-a')).toBe(0);
        expect(sectionRowIndex(SECTIONS, 'cat-b')).toBe(1 + CAT_A.length);
        expect(sectionRowIndex(SECTIONS, 'nope')).toBe(-1);
    });

    it('sectionStartOffsets is exact arithmetic over header + row heights', () => {
        // 8 columns, default 32px glyph -> 50px rows, 28px headers.
        const offsets = sectionStartOffsets(SECTIONS, 8);
        expect(offsets[0]).toBe(0);
        expect(offsets[1]).toBe(HEADER_PX + Math.ceil(CAT_A.length / 8) * emojiRowPx());
    });

    it('emits activeSection as the list scrolls across a section boundary', async () => {
        const seen: string[] = [];
        const Harness = component(() => () => (
            <EmojiGrid sections={SECTIONS} itemsKey="s" onActiveSection={(k) => seen.push(k)} />
        ));
        const { container } = render(<Harness />);
        await act(() => {});
        const list = getByType(container, 'list') as unknown as TestNode;
        const scrollTo = async (scrollTop: number): Promise<void> => {
            await act(() => { list._handlers.get('bindscroll')!({ detail: { scrollTop } }); });
        };
        const catBStart = sectionStartOffsets(SECTIONS, 8)[1]!;
        await scrollTo(0);
        // Judged at the sticky header midline: just before the boundary
        // cat-a is still active, at it cat-b takes over.
        await scrollTo(catBStart - HEADER_PX);
        await scrollTo(catBStart);
        await scrollTo(10);
        expect(seen).toEqual(['cat-a', 'cat-b', 'cat-a']);
    });

    it('the picker tab highlight follows the scroll', async () => {
        const { container } = render(
            <EmojiPicker
                data={makeData()}
                showSearch={false}
                showRecents={false}
                classes={{ tabActive: 'is-active' }}
            />,
        );
        await measureRegion(container);
        const activeGlyphs = (): string[] => {
            const bar = getByType(container, 'scroll-view') as unknown as TestNode;
            const glyphs: string[] = [];
            const walk = (n: TestNode & { props?: Record<string, unknown> }): void => {
                const cls = (n as { props?: { class?: string } }).props?.class ?? '';
                if (cls.split(' ').includes('is-active')) glyphs.push(n.textContent());
                for (const c of n.children) walk(c as never);
            };
            walk(bar as never);
            return glyphs;
        };
        // cat-a active at the top; crossing cat-b's start flips the highlight.
        expect(activeGlyphs()).toEqual(['A0']);
        const list = getByType(container, 'list') as unknown as TestNode;
        const catBStart = sectionStartOffsets(SECTIONS, 8)[1]!;
        await act(() => { list._handlers.get('bindscroll')!({ detail: { scrollTop: catBStart + 5 } }); });
        expect(activeGlyphs()).toEqual(['B0']);
        await act(() => { list._handlers.get('bindscroll')!({ detail: { scrollTop: 0 } }); });
        expect(activeGlyphs()).toEqual(['A0']);
    });

    it('recents: no section and no tab when empty at mount', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} />,
        );
        await measureRegion(container);
        const keys = getAllByType(container, 'list-item').map((c) => c.props['item-key'] as string);
        expect(keys).not.toContain('hdr:recents');
        expect(queryByText(container, '\u{1F558}')).toBeNull();  // no recents tab glyph
    });
});
