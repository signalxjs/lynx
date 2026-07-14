/**
 * Unit tests for the JS-side AppState API. Mocks `@sigx/lynx-core` and the
 * Lynx GlobalEventEmitter — real transitions are exercised on-device via
 * examples/showcase.
 *
 * The module keeps process-level state (current value, wiring latches), so
 * every test loads a FRESH module instance via `vi.resetModules()` + dynamic
 * import — no ordering dependencies between tests.
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

// GlobalEventEmitter-shaped `lynx` global. `emitterAvailable` gates
// getJSModule so individual tests can model an API call racing runtime init.
type Listener = (...a: unknown[]) => void;
const emitterListeners = new Map<string, Set<Listener>>();
let emitterAvailable = true;
const emit = (name: string, payload: unknown) => {
    for (const fn of emitterListeners.get(name) ?? []) fn(payload);
};
(globalThis as Record<string, unknown>).lynx = {
    getJSModule: (name: string) =>
        emitterAvailable && name === 'GlobalEventEmitter'
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

type AppStateModule = typeof import('../src/state.js');

/** Fresh module instance per test — resets the process-level latches. */
const loadFresh = async (): Promise<AppStateModule> => {
    vi.resetModules();
    emitterListeners.clear();
    return await import('../src/state.js');
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    emitterAvailable = true;
    bridge.callAsync.mockReset();
    bridge.callAsync.mockResolvedValue({ state: 'active' });
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('AppState', () => {
    it('defaults to active, reports availability, and seeds from the native module once', async () => {
        const api = await loadFresh();
        expect(api.currentAppState()).toBe('active');   // first API call — wires + seeds
        expect(api.isAvailable()).toBe(true);
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledWith('AppState', 'getAppState');
        expect(bridge.callAsync).toHaveBeenCalledTimes(1);
    });

    it('retries emitter wiring when the first API call races runtime init', async () => {
        const api = await loadFresh();
        emitterAvailable = false;

        // No emitter yet: the call succeeds but events can't flow.
        expect(api.currentAppState()).toBe('active');
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(api.currentAppState()).toBe('active');

        // Emitter comes up — the next API call must wire instead of having
        // latched permanently on the failed first attempt.
        emitterAvailable = true;
        api.currentAppState();
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(api.currentAppState()).toBe('background');
    });

    it('retries the native seed after a transient failure', async () => {
        bridge.callAsync.mockRejectedValueOnce(new Error('bridge not ready'));
        const api = await loadFresh();

        api.currentAppState();                          // seed attempt #1 — fails
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledTimes(1);

        bridge.callAsync.mockResolvedValueOnce({ state: 'background' });
        api.currentAppState();                          // retry — succeeds
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledTimes(2);
        expect(api.currentAppState()).toBe('background');
    });

    it('retries the native seed after an error-shaped resolved payload', async () => {
        // The Lynx bridge resolves whatever the native callback passes —
        // failures commonly arrive as resolved { error } payloads, not
        // rejections. The seed latch must treat those as failures too.
        bridge.callAsync.mockResolvedValueOnce({ error: 'native module not ready' });
        const api = await loadFresh();

        api.currentAppState();                          // seed attempt #1 — error payload
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledTimes(1);

        // Queue the good payload BEFORE the next call — any API call triggers
        // the retry, including the assertion below.
        bridge.callAsync.mockResolvedValueOnce({ state: 'background' });
        expect(api.currentAppState()).toBe('active');   // default kept; fires retry
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledTimes(2);
        expect(api.currentAppState()).toBe('background');
    });

    it('dispatches transitions to listeners and dedups consecutive duplicates', async () => {
        const api = await loadFresh();
        const seen: string[] = [];
        const off = api.addAppStateListener((s) => seen.push(s));

        emit(api.APP_STATE_EVENT, { state: 'active' });      // duplicate of default — dropped
        emit(api.APP_STATE_EVENT, { state: 'background' });
        emit(api.APP_STATE_EVENT, { state: 'background' });   // duplicate — dropped
        emit(api.APP_STATE_EVENT, { state: 'active' });

        expect(seen).toEqual(['background', 'active']);
        expect(api.currentAppState()).toBe('active');

        off();
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(seen).toEqual(['background', 'active']);       // unsubscribed — no more calls
    });

    it('ignores malformed payloads', async () => {
        const api = await loadFresh();
        const seen: string[] = [];
        api.addAppStateListener((s) => seen.push(s));

        emit(api.APP_STATE_EVENT, undefined);
        emit(api.APP_STATE_EVENT, {});
        emit(api.APP_STATE_EVENT, { state: 'suspended' });
        emit(api.APP_STATE_EVENT, 'background');

        expect(seen).toEqual([]);
        expect(api.currentAppState()).toBe('active');
    });

    it('exposes a reactive signal that tracks transitions', async () => {
        const api = await loadFresh();
        const sig = api.useAppState();
        expect(sig.value).toBe('active');

        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(sig.value).toBe('background');
        emit(api.APP_STATE_EVENT, { state: 'active' });
        expect(sig.value).toBe('active');
    });

    it('never re-wires or re-seeds after a successful first call', async () => {
        const api = await loadFresh();
        api.currentAppState();                          // wires + seeds
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledTimes(1);

        api.currentAppState();
        api.addAppStateListener(() => {})();
        api.useAppState();
        await flush();
        expect(bridge.callAsync).toHaveBeenCalledTimes(1);   // no additional seed
        expect(emitterListeners.get(api.APP_STATE_EVENT)?.size).toBe(1);   // single forwarder
    });
});
