import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import { signal, type PrimitiveSignal } from '@sigx/reactivity';
import type { AppStateListener, AppStateStatus } from './types.js';

const MODULE = 'AppState';

/**
 * Global event fired by the native publishers (iOS `AppStatePublisher.swift`,
 * Android `AppStatePublisher.kt`) via `GlobalEventEmitter` on every
 * foreground/background transition. Payload: `{ state: 'active' | 'background' }`.
 *
 * Kept as a constant so both native publishers and the JS listener agree on a
 * single string.
 */
export const APP_STATE_EVENT = 'appStateChanged';

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

// JS boots with the app foregrounded in every ordinary launch; the async
// native seed (below) corrects the rare background boot.
let current: AppStateStatus = 'active';
let emitterWired = false;
let seeded = false;
const listeners = new Set<AppStateListener>();
let stateSignal: PrimitiveSignal<AppStateStatus> | undefined;

const dispatch = (next: AppStateStatus): void => {
    // Dedup consecutive duplicates: multiple LynxViews mean multiple native
    // publishers, and iOS fires didBecomeActive on cold start too.
    if (next === current) return;
    current = next;
    if (stateSignal) stateSignal.value = next;
    for (const fn of listeners) fn(next);
};

const isStatus = (v: unknown): v is AppStateStatus => v === 'active' || v === 'background';

/**
 * Wire the GlobalEventEmitter listener + native seed, lazily. Each latch is
 * only set on SUCCESS (same pattern as lynx-http's `ensureSubscribed`): if
 * the first API call races runtime init and the emitter isn't reachable yet,
 * a later call retries instead of leaving the module permanently unwired.
 * Off-device (web preview, SSR, tests) neither ever succeeds — a silent no-op.
 */
const ensureWired = (): void => {
    if (!emitterWired) {
        try {
            const emitter = typeof lynx !== 'undefined'
                ? (lynx as LynxLike).getJSModule?.('GlobalEventEmitter')
                : undefined;
            if (emitter) {
                emitter.addListener(APP_STATE_EVENT, (payload: unknown) => {
                    const state = (payload as { state?: unknown } | undefined)?.state;
                    if (isStatus(state)) dispatch(state);
                });
                emitterWired = true;
            }
        } catch {
            // getJSModule threw — retry on the next API call.
        }
    }

    // Authoritative seed for the rare background boot (e.g. launched by the
    // OS while backgrounded). Fire-and-forget: the default 'active' is right
    // for every ordinary launch.
    if (!seeded && isModuleAvailable(MODULE)) {
        seeded = true;
        void callAsync<{ state?: unknown }>(MODULE, 'getAppState')
            .then((res) => { if (isStatus(res?.state)) dispatch(res.state); })
            .catch(() => { /* module present but call failed — keep the default */ });
    }
};

/**
 * Current app state, synchronously. `'active'` until the first transition —
 * including off-device (web preview, SSR, tests), where no events ever fire.
 */
export function currentAppState(): AppStateStatus {
    ensureWired();
    return current;
}

/**
 * Subscribe to foreground/background transitions. The callback fires on every
 * change (never for consecutive duplicates). Returns an unsubscribe function.
 *
 * Off-device this is a safe no-op: the callback simply never fires.
 */
export function addAppStateListener(cb: AppStateListener): () => void {
    ensureWired();
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/**
 * Reactive read of the app state. Returns a lazily-created singleton signal —
 * components reading `.value` re-render on foreground/background transitions.
 */
export function useAppState(): PrimitiveSignal<AppStateStatus> {
    ensureWired();
    if (!stateSignal) stateSignal = signal<AppStateStatus>(current);
    return stateSignal;
}

/** Quick check whether the native AppState module is registered. */
export function isAvailable(): boolean {
    return isModuleAvailable(MODULE);
}
