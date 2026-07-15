import { describe, it, expect, vi } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, getAllByType, getByType, getByText, queryByText, act } from '@sigx/lynx-testing';
import { EmojiGrid } from '../src/components/EmojiGrid';
import { EmojiPicker } from '../src/components/EmojiPicker';
import type { EmojiData, EmojiDatum } from '../src/data/schema';

// The real <Pressable> is an MT gesture recognizer the BG test harness can't
// drive (same constraint as lynx-updates-ui's components tests). Swap it for
// a plain view with tap/long-press handlers so cells and tabs are drivable.
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

// Must track EmojiGrid's window math: 8 columns × ROWS_INITIAL rows.
const WINDOW_CELLS = 8 * 8;

const makeEmojis = (prefix: string, n: number, c: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({
        e: `${prefix}${i}`,
        n: `${prefix} ${i}`,
        c,
        o: c * 1000 + i,
        // Give the first emoji tone variants so a long-press opens the popover.
        ...(i === 0 ? { s: [1, 2, 3, 4, 5].map((t) => `${prefix}0~${t}`) } : {}),
    }));

// Two categories sized like the real extremes: bigger and smaller than the window.
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

// Six small categories (10 cells each, prefixes P..U) for the mounted-grid
// LRU tests — enough tabs to overflow MAX_MOUNTED_GRIDS (4).
const LRU_PREFIXES = ['P', 'Q', 'R', 'S', 'T', 'U'];
const makeLruData = (): EmojiData => ({
    locale: 'en',
    categories: LRU_PREFIXES.map((p) => ({ key: `cat-${p}`, label: `category ${p}` })),
    emojis: LRU_PREFIXES.flatMap((p, i) => makeEmojis(p, 10, i)),
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

describe('EmojiGrid (windowed List)', () => {
    it('mounts only the initial window of a big category, not every cell', () => {
        const { container } = render(<EmojiGrid emojis={CAT_A} />);
        const cells = getAllByType(container, 'list-item');
        expect(cells.length).toBe(WINDOW_CELLS); // 120, not 388
        expect(cells[0].props['item-key']).toBe('A0');
        expect(cells[0].props['item-type']).toBe('emoji');
        // Default cell estimate: 6+6px padding + 26px glyph at ~1.2 line-height.
        expect(cells[0].props['estimated-main-axis-size-px']).toBe(43);
    });

    it('scales the window with the column count (rows, not cells)', () => {
        const { container } = render(<EmojiGrid emojis={CAT_A} columns={4} />);
        const list = getAllByType(container, 'list')[0];
        expect(list.props['span-count']).toBe(4);
        expect(list.props['list-type']).toBe('flow');
        expect(getAllByType(container, 'list-item').length).toBe(4 * 8);
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
        expect(cells.length).toBe(CAT_B.length); // 50 — smaller than the window
        expect(cells[0].props['item-key']).toBe('B0');
    });
});

describe('EmojiPicker (windowed grid integration)', () => {
    // Tab taps are two-phase (highlight now, grid swap on the next tick), so
    // drive the deferred phase with a real timer hop inside act. Tabs are
    // looked up inside the tab bar's scroll-view — grid cells can contain the
    // same glyph text once a category has mounted.
    async function tapTab(container: unknown, glyph: string): Promise<void> {
        const bar = getByType(container as never, 'scroll-view');
        const tabNode = findByHandler(bar as never, 'bindtap', glyph);
        expect(tabNode).toBeTruthy();
        await act(async () => {
            tabNode!._handlers.get('bindtap')!();
            await new Promise((resolve) => setTimeout(resolve, 1));
        });
    }

    it('switches categories via the tab bar, keeping exactly one grid mounted', async () => {
        // Only the active tab's grid is mounted: a hidden grid has a
        // zero-height container and dispatches `scrolltolower` to JS forever,
        // flooding the engine's limiter (#606).
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} />,
        );
        await act(() => {});
        expect(getAllByType(container, 'list-item').length).toBe(WINDOW_CELLS);
        await tapTab(container, 'B0');
        const keys = getAllByType(container, 'list-item').map((c) => c.props['item-key'] as string);
        expect(keys.length).toBe(CAT_B.length);   // B only — A is gone, not hidden
        expect(keys).toContain('B0');
        expect(keys).not.toContain('A0');
    });

    it('unmounting cancels the pending tab swap (no late signal writes)', async () => {
        vi.useFakeTimers();
        const { unmount } = render(
            <EmojiPicker data={makeLruData()} showSearch={false} showRecents={false} />,
        );
        try {
            unmount();
            await vi.advanceTimersByTimeAsync(2000);
        } finally {
            vi.useRealTimers();
        }
        await act(() => {});
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
        await act(() => {});
        expect(renderCell).toHaveBeenCalledTimes(WINDOW_CELLS);
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
        await act(() => {});
        const cell = findByHandler(container as never, 'bindlongpress', 'A1');
        await act(() => { cell!._handlers.get('bindlongpress')!(); });
        expect(queryByText(container, 'A1~1')).toBeNull();
    });
});
