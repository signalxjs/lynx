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

// 8 columns × 15 rows — must match EmojiGrid's ROWS_INITIAL window math.
const WINDOW_CELLS = 8 * 8;  // must track EmojiGrid ROWS_INITIAL

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

    it('switches categories via the tab bar; visited grids stay mounted', async () => {
        const { container } = render(
            <EmojiPicker data={makeData()} showSearch={false} showRecents={false} />,
        );
        await act(() => {});
        expect(getAllByType(container, 'list-item').length).toBe(WINDOW_CELLS);
        await tapTab(container, 'B0');
        const keys = getAllByType(container, 'list-item').map((c) => c.props['item-key'] as string);
        // Category A's grid stays mounted (hidden via use:show) next to B's.
        expect(keys.length).toBe(WINDOW_CELLS + CAT_B.length);
        expect(keys).toContain('B0');
        expect(keys).toContain('A0');
    });

    it('caps mounted grids at 4 (LRU) — visiting a 5th evicts the oldest', async () => {
        const { container } = render(
            <EmojiPicker data={makeLruData()} showSearch={false} showRecents={false} />,
        );
        await act(() => {});
        // Visit P (initial) then Q, R, S, T — five tabs, cap is four.
        for (const p of ['Q', 'R', 'S', 'T']) await tapTab(container, `${p}0`);
        const keys = getAllByType(container, 'list-item').map((c) => c.props['item-key'] as string);
        expect(keys.length).toBe(4 * 10);
        expect(keys).not.toContain('P0');            // oldest evicted
        for (const p of ['Q', 'R', 'S', 'T']) expect(keys).toContain(`${p}0`);
    });

    it('revisiting an LRU-retained tab rebuilds nothing; an evicted one rebuilds', async () => {
        const renderCell = vi.fn((d: EmojiDatum, glyph: string) => <text>{`cell:${glyph}`}</text>);
        const { container } = render(
            <EmojiPicker
                data={makeLruData()}
                showSearch={false}
                showRecents={false}
                renderCell={renderCell}
            />,
        );
        await act(() => {});
        for (const p of ['Q', 'R', 'S', 'T']) await tapTab(container, `${p}0`); // P evicted
        renderCell.mockClear();
        await tapTab(container, 'R0');               // retained → zero rebuilds
        expect(renderCell).not.toHaveBeenCalled();
        await tapTab(container, 'P0');               // evicted → rebuilds its 10 cells
        expect(renderCell).toHaveBeenCalledTimes(10);
    });

    it('revisiting a mounted tab swaps in the same flush (LRU bumps without the deferred tick)', async () => {
        const { container } = render(
            <EmojiPicker data={makeLruData()} showSearch={false} showRecents={false} />,
        );
        await act(() => {});
        for (const p of ['Q', 'R', 'S', 'T']) await tapTab(container, `${p}0`); // LRU: Q R S T (P evicted)
        // Re-tap R with NO timer hop — the mounted-tab path is synchronous.
        const bar = getByType(container as never, 'scroll-view');
        const tabR = findByHandler(bar as never, 'bindtap', 'R0');
        await act(() => { tabR!._handlers.get('bindtap')!(); });        // LRU: Q S T R
        // A fresh visit now evicts Q — proving R was bumped without the tick.
        await tapTab(container, 'U0');                                   // LRU: S T R U
        const keys = getAllByType(container, 'list-item').map((c) => c.props['item-key'] as string);
        expect(keys).not.toContain('Q0');
        expect(keys).toContain('R0');
    });

    // NOTE on fake timers here: lynx-testing's act/waitForUpdate flushes via
    // a real setTimeout(0), so `act` deadlocks while timers are faked. The
    // pattern is: fake → advance async (fires the prefetch timers, runs the
    // microtask effects between them) → restore real timers → one act() to
    // let the final flush land.
    it('idle prefetch pre-mounts the next two categories', async () => {
        vi.useFakeTimers();
        const { container } = render(
            <EmojiPicker data={makeLruData()} showSearch={false} showRecents={false} />,
        );
        try {
            expect(getAllByType(container, 'list-item').length).toBe(10);   // P only
            await vi.advanceTimersByTimeAsync(1100);
        } finally {
            vi.useRealTimers();
        }
        await act(() => {});
        const keys = getAllByType(container, 'list-item').map((c) => c.props['item-key'] as string);
        expect(keys.length).toBe(30);                                        // P + prefetched Q, R
        expect(keys).toContain('Q0');
        expect(keys).toContain('R0');
    });

    it('unmounting cancels pending prefetch timers (no late signal writes)', async () => {
        vi.useFakeTimers();
        const { unmount } = render(
            <EmojiPicker data={makeLruData()} showSearch={false} showRecents={false} />,
        );
        try {
            unmount();
            // Firing the would-be prefetch window after unmount must be a
            // no-op (a late $set on a torn-down component would throw/warn).
            await vi.advanceTimersByTimeAsync(2000);
        } finally {
            vi.useRealTimers();
        }
        await act(() => {});
    });

    it('revisiting a category re-renders zero cells (grid kept mounted)', async () => {
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
        await tapTab(container, 'B0');   // first visit builds B's window…
        expect(renderCell).toHaveBeenCalledTimes(WINDOW_CELLS + CAT_B.length);
        renderCell.mockClear();
        await tapTab(container, 'A0');   // …revisits build nothing
        await tapTab(container, 'B0');
        expect(renderCell).not.toHaveBeenCalled();
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
