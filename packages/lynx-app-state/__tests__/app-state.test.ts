/**
 * Unit tests for the JS-side AppState API. Mocks `@sigx/lynx-core` and the
 * Lynx GlobalEventEmitter — real transitions are exercised on-device via
 * examples/showcase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => ({ state: 'active' }) as unknown),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

// Install a GlobalEventEmitter-shaped `lynx` global BEFORE the module wires
// itself (it captures the listener at first API call).
type Listener = (...a: unknown[]) => void;
const emitterListeners = new Map<string, Set<Listener>>();
const emit = (name: string, payload: unknown) => {
    for (const fn of emitterListeners.get(name) ?? []) fn(payload);
};
(globalThis as Record<string, unknown>).lynx = {
    getJSModule: (name: string) =>
        name === 'GlobalEventEmitter'
            ? {
                addListener: (event: string, fn: Listener) => {
                    let set = emitterListeners.get(event);
                    if (!set) { set = new Set(); emitterListeners.set(event, set); }
                    set.add(fn);
                },
                removeListener: (event: string, fn: Listener) => {
                    emitterListeners.get(event)?.delete(fn);
                },
            }
            : undefined,
};

const { currentAppState, addAppStateListener, useAppState, isAvailable, APP_STATE_EVENT } =
    await import('../src/state.js');

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.isModuleAvailable.mockClear();
});

describe('AppState', () => {
    it('defaults to active, reports availability, and seeds from the native module once', async () => {
        expect(currentAppState()).toBe('active');   // first API call — wires + seeds
        expect(isAvailable()).toBe(true);
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledWith('AppState', 'getAppState');
        expect(bridge.callAsync).toHaveBeenCalledTimes(1);
    });

    it('dispatches transitions to listeners and dedups consecutive duplicates', () => {
        const seen: string[] = [];
        const off = addAppStateListener((s) => seen.push(s));

        emit(APP_STATE_EVENT, { state: 'active' });      // duplicate of default — dropped
        emit(APP_STATE_EVENT, { state: 'background' });
        emit(APP_STATE_EVENT, { state: 'background' });   // duplicate — dropped
        emit(APP_STATE_EVENT, { state: 'active' });

        expect(seen).toEqual(['background', 'active']);
        expect(currentAppState()).toBe('active');

        off();
        emit(APP_STATE_EVENT, { state: 'background' });
        expect(seen).toEqual(['background', 'active']);   // unsubscribed — no more calls
        emit(APP_STATE_EVENT, { state: 'active' });       // restore for later tests
    });

    it('ignores malformed payloads', () => {
        const seen: string[] = [];
        const off = addAppStateListener((s) => seen.push(s));

        emit(APP_STATE_EVENT, undefined);
        emit(APP_STATE_EVENT, {});
        emit(APP_STATE_EVENT, { state: 'suspended' });
        emit(APP_STATE_EVENT, 'background');

        expect(seen).toEqual([]);
        expect(currentAppState()).toBe('active');
        off();
    });

    it('exposes a reactive signal that tracks transitions', () => {
        const sig = useAppState();
        expect(sig.value).toBe(currentAppState());

        emit(APP_STATE_EVENT, { state: 'background' });
        expect(sig.value).toBe('background');
        emit(APP_STATE_EVENT, { state: 'active' });
        expect(sig.value).toBe('active');
    });

    it('never re-wires or re-seeds on subsequent API calls', async () => {
        // beforeEach cleared the mock; the module-level latch means no
        // further callAsync regardless of how many API calls follow.
        currentAppState();
        addAppStateListener(() => {})();
        useAppState();
        await flush();
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });
});
