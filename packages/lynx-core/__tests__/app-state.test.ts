/**
 * App state — foreground/background signal hosted by core's `SigxCore` native
 * module. Uses the REAL bridge (like device-info.test) with a stubbed
 * `NativeModules` + `lynx` GlobalEventEmitter, so these pin the actual wiring:
 * lazy emitter subscription (retried until reachable), a native seed for the
 * background boot (retried on failure / error payload), dedup, and a re-seed
 * when emitter wiring lands late.
 *
 * The module keeps process-level latches, so each test loads a FRESH instance
 * via vi.resetModules() + dynamic import — no ordering dependencies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Globals = Record<string, unknown>;

// Stubbed GlobalEventEmitter. `emitterAvailable` gates getJSModule so a test
// can model an API call racing runtime init (emitter not ready yet).
type Listener = (...a: unknown[]) => void;
const emitterListeners = new Map<string, Set<Listener>>();
let emitterAvailable = true;
const emit = (name: string, payload: unknown) => {
    for (const fn of emitterListeners.get(name) ?? []) fn(payload);
};

// The native getAppState callback impl, swappable per test.
let getAppStateImpl: ((cb: (r: unknown) => void) => void) | null =
    (cb) => cb({ state: 'active' });
let getAppStateCalls = 0;

const installGlobals = (): void => {
    (globalThis as Globals).lynx = {
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
    (globalThis as Globals).NativeModules = getAppStateImpl
        ? { SigxCore: { getAppState: (cb: (r: unknown) => void) => { getAppStateCalls++; getAppStateImpl!(cb); } } }
        : {};
};

type AppStateApi = typeof import('../src/app-state.js');
const loadFresh = async (): Promise<AppStateApi> => {
    vi.resetModules();
    emitterListeners.clear();
    installGlobals();
    return await import('../src/app-state.js');
};

// Drain all pending microtasks — the seed's rejection path chains .then→.catch
// (two hops), which a single `await Promise.resolve()` wouldn't flush.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    emitterAvailable = true;
    getAppStateCalls = 0;
    getAppStateImpl = (cb) => cb({ state: 'active' });
});

afterEach(() => {
    delete (globalThis as Globals).lynx;
    delete (globalThis as Globals).NativeModules;
});

describe('app-state', () => {
    it('defaults to active, reports availability, and seeds from SigxCore once', async () => {
        const api = await loadFresh();
        expect(api.currentAppState()).toBe('active');
        expect(api.isAppStateAvailable()).toBe(true);
        await flush();
        expect(getAppStateCalls).toBe(1);
    });

    it('retries emitter wiring when the first API call races runtime init', async () => {
        const api = await loadFresh();
        emitterAvailable = false;

        expect(api.currentAppState()).toBe('active');
        emit(api.APP_STATE_EVENT, { state: 'background' });   // no listener yet
        expect(api.currentAppState()).toBe('active');

        emitterAvailable = true;
        api.currentAppState();                                 // wires now
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(api.currentAppState()).toBe('background');
    });

    it('re-seeds after late emitter wiring so a transition in the gap is not missed', async () => {
        const api = await loadFresh();
        emitterAvailable = false;
        api.currentAppState();                                 // seed #1 → 'active'
        await flush();
        expect(getAppStateCalls).toBe(1);

        // App backgrounds while the emitter is still down; the event is lost.
        getAppStateImpl = (cb) => cb({ state: 'background' });
        emitterAvailable = true;
        api.currentAppState();                                 // wires + re-seeds
        await flush();
        expect(getAppStateCalls).toBe(2);
        expect(api.currentAppState()).toBe('background');
    });

    it('retries the seed after a rejected call', async () => {
        getAppStateImpl = () => { throw new Error('bridge not ready'); };
        const api = await loadFresh();
        api.currentAppState();                                 // attempt #1 throws
        await flush();
        expect(getAppStateCalls).toBe(1);

        getAppStateImpl = (cb) => cb({ state: 'background' });
        api.currentAppState();                                 // retry succeeds
        await flush();
        expect(getAppStateCalls).toBe(2);
        expect(api.currentAppState()).toBe('background');
    });

    it('retries the seed after an error-shaped resolved payload', async () => {
        getAppStateImpl = (cb) => cb({ error: 'native module not ready' });
        const api = await loadFresh();
        api.currentAppState();                                 // attempt #1 → error payload
        await flush();
        expect(getAppStateCalls).toBe(1);

        getAppStateImpl = (cb) => cb({ state: 'background' });
        api.currentAppState();                                 // retry
        await flush();
        expect(getAppStateCalls).toBe(2);
        expect(api.currentAppState()).toBe('background');
    });

    it('dispatches transitions and dedups consecutive duplicates', async () => {
        const api = await loadFresh();
        const seen: string[] = [];
        const off = api.addAppStateListener((s) => seen.push(s));

        emit(api.APP_STATE_EVENT, { state: 'active' });        // duplicate of default — dropped
        emit(api.APP_STATE_EVENT, { state: 'background' });
        emit(api.APP_STATE_EVENT, { state: 'background' });     // duplicate — dropped
        emit(api.APP_STATE_EVENT, { state: 'active' });

        expect(seen).toEqual(['background', 'active']);

        off();
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(seen).toEqual(['background', 'active']);         // unsubscribed
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

    it('is a no-op off-device (no native module, no emitter)', async () => {
        getAppStateImpl = null;         // NativeModules has no SigxCore
        emitterAvailable = false;
        const api = await loadFresh();
        expect(api.isAppStateAvailable()).toBe(false);
        expect(api.currentAppState()).toBe('active');
        const seen: string[] = [];
        api.addAppStateListener((s) => seen.push(s));
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(seen).toEqual([]);
    });
});
