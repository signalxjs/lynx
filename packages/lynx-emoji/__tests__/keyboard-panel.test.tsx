/**
 * KeyboardPanelPicker mount semantics (#677):
 *  - cold (no `warm`, never opened): nothing mounted but a placeholder.
 *  - `warm`: the picker pre-mounts CLOSED, parked offscreen at full panel
 *    size (a real height — zero-height/hidden grids flood scroll events,
 *    #606 — and a transform keeps it invisible and unhittable).
 *  - once opened it stays mounted across toggles (scroll/recents survive;
 *    reopening is a style swap).
 */

import { describe, expect, it, vi } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render, getAllByType, act } from '@sigx/lynx-testing';
import { KeyboardPanelPicker } from '../src/wrappers/KeyboardPanelPicker';
import type { EmojiData, EmojiDatum } from '../src/data/schema';

// A real signal, not a plain box: the wrapper WATCHES the lift to adopt new
// keyboard heights, so the tests must be able to fire genuine changes.
const liftBox = signal(0);
vi.mock('@sigx/lynx-keyboard', () => ({
    useKeyboardLift: () => liftBox,
}));

const makeEmojis = (n: number): EmojiDatum[] =>
    Array.from({ length: n }, (_, i) => ({ e: `E${i}`, n: `emoji ${i}`, c: 0, o: i }));

const DATA: EmojiData = {
    locale: 'en',
    categories: [{ key: 'cat-a', label: 'category a' }],
    emojis: makeEmojis(24),
    skinTones: ['1', '2', '3', '4', '5'],
};

type StyledNode = { props: Record<string, unknown> };

function panelOuter(container: unknown): StyledNode | undefined {
    // The panel's OUTER wrapper: the view whose style toggles between the
    // open px height and the parked 0px collapse.
    return (getAllByType(container as never, 'view') as unknown as StyledNode[])
        .find((v) => {
            const st = v.props.style as Record<string, unknown> | undefined;
            return st !== undefined && typeof st.height === 'string' && st.height.endsWith('px')
                && (st.overflow === 'hidden' || st.height !== '0px');
        });
}

function innerPanel(container: unknown): StyledNode | undefined {
    // The inner view pinning the picker's real height in both states.
    return (getAllByType(container as never, 'view') as unknown as StyledNode[])
        .find((v) => {
            const st = v.props.style as Record<string, unknown> | undefined;
            return st !== undefined && st.flexShrink === 0 && typeof st.height === 'string' && st.height.endsWith('px');
        });
}

describe('KeyboardPanelPicker (#677)', () => {
    it('closed at mount stays zero-height even when the keyboard is up (stale-lift guard)', async () => {
        liftBox.value = 280;   // screen mounted mid-dismiss: nonzero lift visible at mount
        try {
            const { container } = render(
                <KeyboardPanelPicker warm open={false} data={DATA} onPick={() => {}} />,
            );
            await act(() => {});
            const outer = panelOuter(container)!.props.style as Record<string, unknown>;
            expect(outer.height).toBe('0px');   // closed = ZERO flow footprint, lift or not
            expect(outer.overflow).toBe('hidden');
        } finally {
            liftBox.value = 0;
        }
    });

    it('cold: renders only a hidden placeholder until first open', async () => {
        const { container } = render(
            <KeyboardPanelPicker open={false} data={DATA} onPick={() => {}} />,
        );
        await act(() => {});
        expect(getAllByType(container, 'input').length).toBe(0); // no search row → no picker
        expect(panelOuter(container)).toBeUndefined();
    });

    it('warm: pre-mounts closed, parked offscreen at full panel size', async () => {
        const { container } = render(
            <KeyboardPanelPicker warm open={false} data={DATA} onPick={() => {}} />,
        );
        await act(() => {});
        // The search row renders pre-hydration — a mount-invariant marker
        // (the tab bar waits for ctx.ready, a macrotask later).
        expect(getAllByType(container, 'input').length).toBeGreaterThan(0); // picker is live
        // Parked = ZERO flow footprint (the bar must hug the bottom while
        // closed) + clipping; the INNER view keeps the real panel height so
        // the grid never collapses (#606) and geometry survives toggles.
        const outer = panelOuter(container)!.props.style as Record<string, unknown>;
        expect(outer.height).toBe('0px');
        expect(outer.overflow).toBe('hidden');
        const inner = innerPanel(container)!.props.style as Record<string, unknown>;
        expect(inner.height).toBe('300px'); // fallbackHeight default — REAL size
    });

    it('open: in-flow at panel height; close keeps it mounted offscreen', async () => {
        const open = signal(true);
        const Harness = component(() => () => (
            <KeyboardPanelPicker warm={false} open={open.value} data={DATA} onPick={() => {}} />
        ));
        const { container } = render(<Harness />);
        await act(() => {});
        let outer = panelOuter(container)!.props.style as Record<string, unknown>;
        expect(outer.height).toBe('300px');
        expect(outer.overflow).toBeUndefined();

        await act(() => { open.value = false; });
        // Still mounted — parked (collapsed + clipped), not torn down.
        expect(getAllByType(container, 'input').length).toBeGreaterThan(0);
        outer = panelOuter(container)!.props.style as Record<string, unknown>;
        expect(outer.height).toBe('0px');
        expect(outer.overflow).toBe('hidden');
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('300px');

        await act(() => { open.value = true; });
        outer = panelOuter(container)!.props.style as Record<string, unknown>;
        expect(outer.height).toBe('300px');
    });
});

describe('KeyboardPanelPicker expanded stage (#677)', () => {
    it('paints at expandedHeight while open, without disturbing the compact memory', async () => {
        liftBox.value = 0;
        const open = signal(true);
        const expandedH = signal<number | undefined>(undefined);
        const Harness = component(() => () => (
            <KeyboardPanelPicker
                warm
                open={open.value}
                expandedHeight={expandedH.value}
                data={DATA}
                onPick={() => {}}
            />
        ));
        const { container } = render(<Harness />);
        // Remember a keyboard lift while parked — the compact detent.
        await act(() => { open.value = false; });
        await act(() => { liftBox.value = 320; });
        await act(() => { open.value = true; });
        expect((panelOuter(container)!.props.style as Record<string, unknown>).height).toBe('320px');

        // Expanded stage paints tall…
        await act(() => { expandedH.value = 900; });
        expect((panelOuter(container)!.props.style as Record<string, unknown>).height).toBe('900px');
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('900px');

        // …and collapsing returns to the REMEMBERED keyboard lift exactly —
        // the swap invariant survives an expand/collapse round trip.
        await act(() => { expandedH.value = undefined; });
        expect((panelOuter(container)!.props.style as Record<string, unknown>).height).toBe('320px');
    });

    it('ignores expandedHeight while closed (parking stays collapsed at compact size)', async () => {
        liftBox.value = 0;
        const open = signal(false);
        const Harness = component(() => () => (
            <KeyboardPanelPicker warm open={open.value} expandedHeight={900} data={DATA} onPick={() => {}} />
        ));
        const { container } = render(<Harness />);
        await act(() => { liftBox.value = 320; });
        const outer = panelOuter(container)!.props.style as Record<string, unknown>;
        expect(outer.height).toBe('0px');           // parked
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('320px');
    });
});

describe('KeyboardPanelPicker height memory (#677 flip-back)', () => {
    it('freezes the painted height while open; adopts the new height on close (shrink AND grow)', async () => {
        liftBox.value = 0;
        const open = signal(true);
        const Harness = component(() => () => (
            <KeyboardPanelPicker warm open={open.value} data={DATA} onPick={() => {}} />
        ));
        const { container } = render(<Harness />);
        // Keyboard height seen while parked → adopted.
        await act(() => { open.value = false; });
        await act(() => { liftBox.value = 320; });
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('320px');

        // While PAINTED, a differing return height must not resize the panel
        // (that would move the pinned bar mid-swap)…
        await act(() => { open.value = true; });
        await act(() => { liftBox.value = 0; });     // keyboard hidden behind the panel
        await act(() => { liftBox.value = 356; });   // returning keyboard, taller (suggestion strip)
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('320px');

        // …and is adopted the moment the panel parks, for the next cycle.
        await act(() => { open.value = false; });
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('356px');

        // Shrink adopts too (strip disappeared while parked).
        await act(() => { liftBox.value = 290; });
        expect((innerPanel(container)!.props.style as Record<string, unknown>).height).toBe('290px');
    });
});
