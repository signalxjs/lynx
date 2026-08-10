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
// Deliberately does NOT catch: native dispatch walks one listener list per
// channel, so an exception escaping one listener aborts delivery to the rest.
const emit = (name: string, payload: unknown) => {
    for (const fn of emitterListeners.get(name) ?? []) fn(payload);
};

/** Register a listener on the channel directly, as another package would. */
const addSiblingListener = (name: string, fn: Listener) => {
    let set = emitterListeners.get(name);
    if (!set) { set = new Set(); emitterListeners.set(name, set); }
    set.add(fn);
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
        expect(api.AppState.current).toBe('active');
        expect(api.AppState.available).toBe(true);
        await flush();
        expect(getAppStateCalls).toBe(1);
    });

    it('retries emitter wiring when the first API call races runtime init', async () => {
        const api = await loadFresh();
        emitterAvailable = false;

        expect(api.AppState.current).toBe('active');
        emit(api.APP_STATE_EVENT, { state: 'background' });   // no listener yet
        expect(api.AppState.current).toBe('active');

        emitterAvailable = true;
        api.AppState.current;                                 // wires now
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(api.AppState.current).toBe('background');
    });

    it('re-seeds after late emitter wiring so a transition in the gap is not missed', async () => {
        const api = await loadFresh();
        emitterAvailable = false;
        api.AppState.current;                                 // seed #1 → 'active'
        await flush();
        expect(getAppStateCalls).toBe(1);

        // App backgrounds while the emitter is still down; the event is lost.
        getAppStateImpl = (cb) => cb({ state: 'background' });
        emitterAvailable = true;
        api.AppState.current;                                 // wires + re-seeds
        await flush();
        expect(getAppStateCalls).toBe(2);
        expect(api.AppState.current).toBe('background');
    });

    it('retries the seed after a rejected call', async () => {
        getAppStateImpl = () => { throw new Error('bridge not ready'); };
        const api = await loadFresh();
        api.AppState.current;                                 // attempt #1 throws
        await flush();
        expect(getAppStateCalls).toBe(1);

        getAppStateImpl = (cb) => cb({ state: 'background' });
        api.AppState.current;                                 // retry succeeds
        await flush();
        expect(getAppStateCalls).toBe(2);
        expect(api.AppState.current).toBe('background');
    });

    it('retries the seed after an error-shaped resolved payload', async () => {
        getAppStateImpl = (cb) => cb({ error: 'native module not ready' });
        const api = await loadFresh();
        api.AppState.current;                                 // attempt #1 → error payload
        await flush();
        expect(getAppStateCalls).toBe(1);

        getAppStateImpl = (cb) => cb({ state: 'background' });
        api.AppState.current;                                 // retry
        await flush();
        expect(getAppStateCalls).toBe(2);
        expect(api.AppState.current).toBe('background');
    });

    it('dispatches transitions and dedups consecutive duplicates', async () => {
        const api = await loadFresh();
        const seen: string[] = [];
        const off = api.AppState.subscribe((s) => seen.push(s));

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
        api.AppState.subscribe((s) => seen.push(s));

        emit(api.APP_STATE_EVENT, undefined);
        emit(api.APP_STATE_EVENT, {});
        emit(api.APP_STATE_EVENT, { state: 'suspended' });
        emit(api.APP_STATE_EVENT, 'background');

        expect(seen).toEqual([]);
        expect(api.AppState.current).toBe('active');
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

    it('accepts a payload delivered as a JSON string', async () => {
        // The bridge sends either shape depending on the path (#342). The
        // hand-rolled listener read `.state` off the raw payload, so a string
        // payload was silently dropped and the app never saw the transition.
        const api = await loadFresh();
        const seen: string[] = [];
        api.AppState.subscribe((s) => seen.push(s));

        emit(api.APP_STATE_EVENT, JSON.stringify({ state: 'background' }));

        expect(seen).toEqual(['background']);
        expect(api.AppState.current).toBe('background');
    });

    it('is a no-op off-device (no native module, no emitter)', async () => {
        getAppStateImpl = null;         // NativeModules has no SigxCore
        emitterAvailable = false;
        const api = await loadFresh();
        expect(api.AppState.available).toBe(false);
        expect(api.AppState.current).toBe('active');
        const seen: string[] = [];
        api.AppState.subscribe((s) => seen.push(s));
        emit(api.APP_STATE_EVENT, { state: 'background' });
        expect(seen).toEqual([]);
    });
});

/**
 * The C7 contract (`subscribeNative`), exercised through app-state because it
 * is the only module here that hands a disposer to consumers.
 */
describe('app-state — C7 native subscription', () => {
    it('contains a throwing subscriber instead of letting it escape into native dispatch', async () => {
        // The bug this sweep exists to catch. `AppState.subscribe` callbacks
        // run synchronously inside the signal write the emitter listener
        // performs, so before the migration a consumer that threw propagated
        // straight out of the listener into native dispatch — killing delivery
        // for every other package listening on `appStateChanged` (core's own
        // DeviceInfo does), with no error anyone could act on.
        getAppStateImpl = null;                    // isolate from the seed path
        const api = await loadFresh();
        api.AppState.subscribe(() => { throw new Error('consumer bug'); });

        // Another package's listener, registered after ours.
        const sibling: unknown[] = [];
        addSiblingListener(api.APP_STATE_EVENT, (p) => { sibling.push(p); });

        expect(() => emit(api.APP_STATE_EVENT, { state: 'background' })).not.toThrow();
        expect(sibling).toEqual([{ state: 'background' }]);
    });

    it('disposes idempotently — double-dispose leaves other subscribers live', async () => {
        // An effect cleanup can fire twice (unmount plus an explicit
        // teardown); C7 requires the second call to be a no-op rather than
        // reaching into shared state a sibling still depends on.
        const api = await loadFresh();
        const first: string[] = [];
        const second: string[] = [];
        const offFirst = api.AppState.subscribe((s) => first.push(s));
        api.AppState.subscribe((s) => second.push(s));

        offFirst();
        expect(() => offFirst()).not.toThrow();

        emit(api.APP_STATE_EVENT, { state: 'background' });

        expect(first).toEqual([]);
        expect(second).toEqual(['background']);
    });

    it('registers exactly one native listener however often the API is called', async () => {
        const api = await loadFresh();
        api.AppState.current;
        api.AppState.subscribe(() => {});
        api.useAppState();
        api.AppState.current;

        expect(emitterListeners.get(api.APP_STATE_EVENT)?.size).toBe(1);
    });
});
