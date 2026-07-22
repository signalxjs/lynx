/**
 * The #651 pre-stage settle window must be bounded (#759).
 *
 * `PRE_STAGE_MAX_MS` gates the loop condition, but the awaits inside it are
 * what can hang: `waitForFlush()` resolves only when the host acks the ops
 * batch. A dropped ack left `pendingOps()` true forever, so the transition
 * never started (the incoming screen stayed parked at its pre-stage seed) and
 * the transition signal was never cleared — which makes `isTransitioning()`
 * reject every later push and pop for the rest of the session.
 *
 * `@sigx/lynx-motion` is mocked so `withTiming` never advances the value; the
 * landing pass (#758/#760) is what carries the SV to its target here, which is
 * exactly the starved-tween case both guards exist for.
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
