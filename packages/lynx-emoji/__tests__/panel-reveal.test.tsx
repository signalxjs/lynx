/**
 * useKeyboardPanelReveal (#677 flip-back bug):
 *
 * The keyboard inset event reports the FINAL height once, at the START of
 * the visual rise — the sticky view's MT tween is still in flight. If the
 * space handoff (unpin + collapse) fires on the event itself, the bar's
 * re-registered transform binding adopts a mid-tween value and the input
 * visibly rides up with the keyboard. The reveal hook must stay `closing`
 * (pinned + painted) until `settleMs` after the event, then hand off in one
 * frame.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { component, signal } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';

// lynx-testing's `act` awaits a REAL setTimeout(0) — wedged under fake
// timers — so these tests flush reactivity by pumping the fake clock
// explicitly instead.
async function flush(ms = 0): Promise<void> {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(ms);
}

const liftSignal = signal(0);
vi.mock('@sigx/lynx-keyboard', () => ({
    useKeyboardLift: () => liftSignal,
}));

import { useKeyboardPanelReveal, type KeyboardPanelReveal } from '../src/wrappers/useKeyboardPanelReveal';

function mount(): { reveal: KeyboardPanelReveal; blurs: number[]; focuses: number[] } {
    const box: { reveal: KeyboardPanelReveal | null } = { reveal: null };
    const blurs: number[] = [];
    const focuses: number[] = [];
    const Harness = component(() => {
        box.reveal = useKeyboardPanelReveal({
            blur: () => blurs.push(Date.now()),
            focus: () => focuses.push(Date.now()),
        });
        return () => <view />;
    });
    render(<Harness />);
    return { reveal: box.reveal!, blurs, focuses };
}

beforeEach(() => {
    vi.useFakeTimers();
    liftSignal.value = 0;
});
afterEach(() => {
    vi.useRealTimers();
});

describe('useKeyboardPanelReveal (#677)', () => {
    it('open pins+paints and blurs; close focuses and enters closing', async () => {
        const { reveal, blurs, focuses } = mount();
        liftSignal.value = 280; await flush();   // keyboard was up
        expect(reveal.mode()).toBe('closed');
        reveal.open();
        expect(reveal.mode()).toBe('open');
        expect(reveal.engaged()).toBe(true);
        expect(blurs).toHaveLength(1);
        liftSignal.value = 0; await flush();     // keyboard revealed the panel
        reveal.close();
        expect(reveal.mode()).toBe('closing');
        expect(reveal.engaged()).toBe(true);            // still pinned + painted
        expect(focuses).toHaveLength(1);
    });

    it('stays pinned through the keyboard rise; hands off only settleMs after the inset event', async () => {
        const { reveal } = mount();
        liftSignal.value = 280; await flush();
        reveal.open();
        liftSignal.value = 0; await flush();
        reveal.close();
        expect(reveal.mode()).toBe('closing');
        // The returning keyboard announces its FINAL height in one event…
        liftSignal.value = 280; await flush();
        // …but the visual rise / MT tween is still in flight: no handoff yet.
        expect(reveal.mode()).toBe('closing');
        await flush(300);
        expect(reveal.mode()).toBe('closing');          // 300 < settleMs 350
        await flush(100);
        expect(reveal.mode()).toBe('closed');           // single-frame handoff
        expect(reveal.engaged()).toBe(false);
    });

    it('falls back to closed when no keyboard ever rises after close()', async () => {
        const { reveal } = mount();
        liftSignal.value = 280; await flush();
        reveal.open();
        liftSignal.value = 0; await flush();
        reveal.close();
        expect(reveal.mode()).toBe('closing');
        await flush(650);   // > noKeyboardMs 600
        expect(reveal.mode()).toBe('closed');
    });

    it('closes immediately when a keyboard has never been seen', () => {
        const { reveal } = mount();
        reveal.open();
        reveal.close();
        expect(reveal.mode()).toBe('closed');   // nothing will rise — no wedge
    });

    it('reopening mid-closing cancels the pending handoff', async () => {
        const { reveal, blurs } = mount();
        liftSignal.value = 280; await flush();
        reveal.open();
        liftSignal.value = 0; await flush();
        reveal.close();
        liftSignal.value = 280; await flush();   // keyboard rising
        reveal.open();                                   // user flips back to the panel
        expect(reveal.mode()).toBe('open');
        expect(blurs).toHaveLength(2);
        await flush(1000);
        expect(reveal.mode()).toBe('open');              // stale timer must not close it
    });
});
