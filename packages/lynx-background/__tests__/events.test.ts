/**
 * C7 tests for the native-fire subscription.
 *
 * The package no longer owns an emitter shim — `addBackgroundFireListener`
 * delegates to `subscribeNative` from `@sigx/lynx-core`. These tests use the
 * REAL `subscribeNative` (only `lynx.getJSModule` is faked) so they exercise
 * the contract as consumers get it: the payload guard, the string-encoded
 * wire form, listener isolation, and — the one C7 turns on — an idempotent
 * disposer.
 *
 * The fake emitter counts registrations so a disposer that unhooks twice is
 * visible. Vitest isolates test files, so the `lynx` global set here does not
 * leak into `background.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...a: unknown[]) => void;

/**
 * Emitter double. `addListener` / `removeListener` are spies so the *number*
 * of unhook calls a disposer makes is observable — that, not the resulting
 * listener set, is what the idempotency guard controls.
 */
const emitter = {
    listeners: new Map<string, Listener[]>(),
    addListener: vi.fn((name: string, fn: Listener) => {
        const arr = emitter.listeners.get(name) ?? [];
        arr.push(fn);
        emitter.listeners.set(name, arr);
    }),
    removeListener: vi.fn((name: string, fn: Listener) => {
        const arr = emitter.listeners.get(name);
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
    }),
    fire(name: string, ...args: unknown[]) {
        // Iterate a copy: a listener is allowed to unsubscribe during dispatch,
        // which would otherwise mutate the array mid-loop.
        const snapshot = (emitter.listeners.get(name) ?? []).slice();
        for (const fn of snapshot) fn(...args);
    },
};

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
};

const { addBackgroundFireListener, __FIRE_CHANNEL_FOR_TESTS: FIRE } = await import(
    '../src/events.js'
);

beforeEach(() => {
    emitter.addListener.mockClear();
    emitter.removeListener.mockClear();
});

afterEach(() => {
    emitter.listeners.clear();
});

describe('addBackgroundFireListener disposer (C7)', () => {
    it('is idempotent — disposing one listener twice leaves the other subscribed', () => {
        const a = vi.fn();
        const b = vi.fn();

        const unsubA = addBackgroundFireListener(a);
        addBackgroundFireListener(b);
        expect(emitter.addListener).toHaveBeenCalledTimes(2);

        // An effect cleanup firing twice (unmount plus an explicit teardown)
        // must not reach past its own registration.
        unsubA();
        unsubA();

        // The guard is what we are testing: the second call must not issue a
        // second unhook. Without it, a host whose removeListener is
        // position-based would drop `b` instead.
        expect(emitter.removeListener).toHaveBeenCalledTimes(1);

        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 'r1' });

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledWith({ taskName: 'refresh-feed', runId: 'r1' });
    });

    it('returns a callable no-op disposer when there is no native emitter', () => {
        const saved = (globalThis as unknown as { lynx: unknown }).lynx;
        (globalThis as unknown as { lynx: unknown }).lynx = {};
        try {
            const unsub = addBackgroundFireListener(vi.fn());
            expect(() => {
                unsub();
                unsub();
            }).not.toThrow();
        } finally {
            (globalThis as unknown as { lynx: unknown }).lynx = saved;
        }
    });
});

describe('addBackgroundFireListener payload handling', () => {
    it('drops payloads missing taskName or runId', () => {
        const cb = vi.fn();
        addBackgroundFireListener(cb);

        emitter.fire(FIRE, { taskName: 'refresh-feed' });
        emitter.fire(FIRE, { runId: 'r2' });
        emitter.fire(FIRE, { taskName: 'refresh-feed', runId: 7 });
        emitter.fire(FIRE, 42);
        emitter.fire(FIRE, null);
        emitter.fire(FIRE, 'not json');

        expect(cb).not.toHaveBeenCalled();
    });

    it('parses string-encoded payloads', () => {
        const cb = vi.fn();
        addBackgroundFireListener(cb);

        emitter.fire(FIRE, JSON.stringify({ taskName: 'refresh-feed', runId: 'r3' }));

        expect(cb).toHaveBeenCalledWith({ taskName: 'refresh-feed', runId: 'r3' });
    });

    it('a throwing listener does not stop the next one or reach the emitter', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bad = vi.fn(() => {
            throw new Error('boom');
        });
        const good = vi.fn();

        addBackgroundFireListener(bad);
        addBackgroundFireListener(good);

        expect(() => emitter.fire(FIRE, { taskName: 't', runId: 'r4' })).not.toThrow();
        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});
