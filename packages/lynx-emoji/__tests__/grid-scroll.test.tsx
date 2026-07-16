/**
 * #666 — staged-aware scroll-to-section (`scrollHandle`).
 *
 * Native silently DROPS a `scrollToPosition` whose index isn't in the list
 * yet, and the sectioned grid stages its rows in budgeted slices — so a fast
 * tab tap right after open used to die. The grid now parks an unstaged
 * target and fires it when staging crosses the index; the latest request
 * wins and genuine manual scrolling cancels it.
 *
 * `runOnMainThread` is intercepted module-wide so the worklet's invocations
 * are observable (the fake renderer has no main thread to bind a ref on).
 */

import { describe, it, expect, vi } from 'vitest';

const scrollCalls: unknown[][] = [];
vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return {
        ...actual,
        runOnMainThread: (_fn: unknown) =>
            (...args: unknown[]): Promise<void> => {
                scrollCalls.push(args);
                return Promise.resolve();
            },
    };
});

import { component, signal } from '@sigx/lynx';
import { SCROLL_METHOD } from '@sigx/lynx-list';
import { render, getAllByType, getByType, act } from '@sigx/lynx-testing';
import { createStagingDriver, EmojiGrid, sectionRowIndex, type EmojiGridScrollHandle, type EmojiSection } from '../src/components/EmojiGrid';
import type { EmojiDatum } from '../src/data/schema';

const makeEmojis = (prefix: string, n: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({ e: `${prefix}${i}`, n: `${prefix} ${i}`, c: 0, o: i }));

/** Two small sections — everything inside the initial staged slice. */
const SMALL: EmojiSection[] = [
    { key: 'cat-a', label: 'a', emojis: makeEmojis('A', 20) },
    { key: 'cat-b', label: 'b', emojis: makeEmojis('B', 20) },
];
/** Big first section — later sections start beyond the initial slice. */
const BIG: EmojiSection[] = [
    { key: 'cat-a', label: 'a', emojis: makeEmojis('A', 388) },
    { key: 'cat-b', label: 'b', emojis: makeEmojis('B', 300) },
    { key: 'cat-c', label: 'c', emojis: makeEmojis('C', 50) },
];

type TestNode = { _handlers: Map<string, (e?: unknown) => void>; children: TestNode[] };

function mountGrid(sections: EmojiSection[]): { handle: EmojiGridScrollHandle; container: unknown } {
    const handle: EmojiGridScrollHandle = { current: null };
    const Harness = component(() => () => (
        <EmojiGrid sections={sections} itemsKey="s" scrollHandle={handle} />
    ));
    const { container } = render(<Harness />);
    return { handle, container };
}

/** Let staging slices + the deferred pending fire (32ms) run to completion. */
async function settleStaging(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 10));
        await act(() => {});
    }
}

const ALT: EmojiSection[] = [
    { key: 'cat-x', label: 'x', emojis: makeEmojis('X', 300) },
    { key: 'cat-y', label: 'y', emojis: makeEmojis('Y', 40) },
];

describe('staging driver reset (#666 review)', () => {
    it('reset() cancels the in-flight slice — no stale mutation lands', async () => {
        const d = createStagingDriver(240);
        d.ensure(1990);                      // slice scheduled for dataset A
        d.reset();                           // dataset swapped mid-flight
        await new Promise((r) => setTimeout(r, 15));
        // Without cancellation the stale slice would have grown this.
        expect(d.staged.value).toBe(240);
        // And the new dataset's staging is NOT blocked by a stuck pending flag.
        d.ensure(500);
        await new Promise((r) => setTimeout(r, 15));
        expect(d.staged.value).toBeGreaterThan(240);
    });

    it('an itemsKey swap mid-staging restarts staging on the new dataset only', async () => {
        const state = signal<{ sections: EmojiSection[]; key: string }>({ sections: BIG, key: 'one' });
        const Harness = component(() => () => (
            <EmojiGrid sections={state.sections} itemsKey={state.key} />
        ));
        const { container } = render(<Harness />);
        await act(() => {});
        // Mid-staging: some rows staged, dataset not complete.
        const midCount = getAllByType(container, 'list-item').length;
        expect(midCount).toBeGreaterThan(0);
        expect(midCount).toBeLessThan(BIG.length + BIG.reduce((n, s) => n + s.emojis.length, 0));
        // Swap the dataset while a slice is in flight. (The count right after
        // the swap races the NEW dataset's first legit slice, so assert on
        // dataset identity, not an exact number.)
        await act(() => { state.$set({ sections: ALT, key: 'two' }); });
        const afterSwap = getAllByType(container, 'list-item');
        expect(afterSwap.length).toBeGreaterThan(0);
        for (const cell of afterSwap) {
            expect(String(cell.props['item-key'])).toMatch(/^(hdr:cat-[xy]|cat-[xy]:)/);
        }
        // Staging then completes for exactly the new dataset.
        await settleStaging();
        expect(getAllByType(container, 'list-item').length)
            .toBe(ALT.length + ALT.reduce((n, s) => n + s.emojis.length, 0));
    });
});

describe('staged-aware scroll-to-section (#666)', () => {
    it('a staged target scrolls immediately', async () => {
        scrollCalls.length = 0;
        const { handle } = mountGrid(SMALL);
        await act(() => {});
        expect(handle.current).toBeTypeOf('function');
        handle.current!('cat-b');
        expect(scrollCalls).toEqual([[sectionRowIndex(SMALL, 'cat-b'), SCROLL_METHOD]]);
    });

    it('an unstaged target parks, then fires once staging crosses it', async () => {
        scrollCalls.length = 0;
        const { handle } = mountGrid(BIG);
        await act(() => {});
        handle.current!('cat-c');   // row 741 — beyond the initial slice
        expect(scrollCalls).toEqual([]);   // parked, not dropped
        await settleStaging();
        expect(scrollCalls).toEqual([[sectionRowIndex(BIG, 'cat-c'), SCROLL_METHOD]]);
    });

    it('the latest parked target wins', async () => {
        scrollCalls.length = 0;
        const { handle } = mountGrid(BIG);
        await act(() => {});
        handle.current!('cat-b');
        handle.current!('cat-c');
        await settleStaging();
        expect(scrollCalls).toEqual([[sectionRowIndex(BIG, 'cat-c'), SCROLL_METHOD]]);
    });

    it('genuine manual scrolling cancels a parked target', async () => {
        scrollCalls.length = 0;
        const { handle, container } = mountGrid(BIG);
        await act(() => {});
        handle.current!('cat-c');
        const list = getByType(container as never, 'list') as unknown as TestNode;
        await act(() => { list._handlers.get('bindscroll')!({ detail: { scrollTop: 500 } }); });
        await settleStaging();
        expect(scrollCalls).toEqual([]);
    });
});
