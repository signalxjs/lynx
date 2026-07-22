/**
 * Transition end-state + pre-stage bounding (#758, #759).
 *
 * Both cover the same failure mode from two directions: a transition whose
 * animation does not complete on the BG-side wall clock must still leave the
 * navigator — and the layer's shared progress value — in the settled state.
 * When it doesn't, `<Layer>` unregisters its MT binding with a half-applied
 * transform still on the element and the screen is stranded off-screen for
 * good (a modal resting low on iOS, a popped-to screen that never comes back
 * into view on web, which reads as "the back button does nothing").
 *
 * `@sigx/lynx-motion` is mocked so `withTiming` never advances the value —
 * that is exactly the starved/never-ticked tween these guards exist for.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { component } from '@sigx/lynx';
import type { SharedValue } from '@sigx/lynx';

import { defineRoutes } from '../src/define-routes';
import { createNavigatorState } from '../src/navigator/core';
import type { StackEntry } from '../src/types';

const withTimingMock = vi.fn();
const cancelAnimationMock = vi.fn();

vi.mock('@sigx/lynx-motion', () => ({
    withTiming: (...args: unknown[]) => withTimingMock(...args),
    cancelAnimation: (...args: unknown[]) => cancelAnimationMock(...args),
}));

/** Controls for the mocked op-queue quiescence probes (see the mock below). */
let flushGate: Promise<void>;
let opsPending: boolean;

vi.mock('@sigx/lynx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sigx/lynx')>();
    return {
        ...actual,
        waitForFlush: () => flushGate,
        pendingOps: () => opsPending,
    };
});

const Screen1 = component(() => () => null);

const routes = defineRoutes({
    home: { component: Screen1 },
    details: { component: Screen1 },
});

const initial: StackEntry = {
    key: 'root',
    route: 'home',
    params: {},
    search: {},
    state: undefined,
    presentation: 'card',
};

/** Minimal SharedValue stand-in: `current.value` is the MT-side field. */
function makeSV(): SharedValue<number> {
    return { current: { value: 0 }, value: 0 } as unknown as SharedValue<number>;
}

beforeEach(() => {
    vi.useFakeTimers();
    withTimingMock.mockClear();
    cancelAnimationMock.mockClear();
    flushGate = Promise.resolve();
    opsPending = false;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('transition end state (#758)', () => {
    it('lands the target on the progress SV even when the tween never advances it', async () => {
        const sv = makeSV();
        const { nav } = createNavigatorState({ routes, initial, progress: sv });

        nav.push('details' as never);
        // Pre-stage parks the incoming layer just off-screen, not at the target.
        expect(sv.current.value).toBeCloseTo(0.002, 5);

        // Settle window + the full transition duration.
        await vi.advanceTimersByTimeAsync(1000);

        expect(withTimingMock).toHaveBeenCalled(); // the tween WAS started…
        expect(sv.current.value).toBe(1); // …and the end state is asserted anyway
        expect(cancelAnimationMock).toHaveBeenCalled();
        expect(nav.transition).toBeNull();
    });

    it('lands the popped-to state so the revealed layer returns to rest', async () => {
        const sv = makeSV();
        const { nav } = createNavigatorState({ routes, initial, progress: sv });

        nav.push('details' as never);
        await vi.advanceTimersByTimeAsync(1000);
        expect(nav.stack.length).toBe(2);

        nav.pop();
        await vi.advanceTimersByTimeAsync(1000);

        expect(sv.current.value).toBe(1); // pop animates progress 0 → 1
        expect(nav.stack.length).toBe(1);
        expect(nav.transition).toBeNull();
    });
});

describe('pre-stage settle window is bounded (#759)', () => {
    it('starts the transition even when a batch ack never arrives', async () => {
        // A dropped `callLepusMethod` ack: the flush promise never settles and
        // the queue reports work forever. `PRE_STAGE_MAX_MS` bounds the LOOP,
        // so without racing the await this hangs and the transition — plus
        // every later push/pop, via `isTransitioning()` — never runs.
        flushGate = new Promise<void>(() => {});
        opsPending = true;

        const sv = makeSV();
        const { nav } = createNavigatorState({ routes, initial, progress: sv });

        nav.push('details' as never);
        await vi.advanceTimersByTimeAsync(1000);

        expect(sv.current.value).toBe(1);
        expect(nav.transition).toBeNull();
    });

    it('leaves the navigator able to pop after a stalled push', async () => {
        flushGate = new Promise<void>(() => {});
        opsPending = true;

        const sv = makeSV();
        const { nav } = createNavigatorState({ routes, initial, progress: sv });

        nav.push('details' as never);
        await vi.advanceTimersByTimeAsync(1000);
        expect(nav.stack.length).toBe(2);

        nav.pop();
        await vi.advanceTimersByTimeAsync(1000);
        expect(nav.stack.length).toBe(1);
    });
});
