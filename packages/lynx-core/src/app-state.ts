import { signal, type PrimitiveSignal } from '@sigx/reactivity';
import { callAsync, isModuleAvailable } from './bridge.js';

/**
 * App activity state, two-state model:
 *
 * - `'active'` — the app is foregrounded and interactive.
 * - `'background'` — the app has been sent to the background.
 *
 * iOS's transient `inactive` phase (control-center pull, incoming call,
 * app-switcher zoom) is deliberately NOT modeled: only
 * `didEnterBackgroundNotification` counts as `'background'`, so brief
 * interruptions don't flap listeners that pause work on background.
 */
export type AppStateStatus = 'active' | 'background';

/** Listener signature for {@link addAppStateListener}. */
export type AppStateListener = (state: AppStateStatus) => void;

// Foreground/background lives in core (not a feature package) because it's an
// ambient lifecycle signal, like DeviceInfo/Platform: tiny, universal, and
// backed by the activity/app-lifecycle plumbing core already owns (Android's
// SigxActivityHook, iOS's app notifications). It exposes both an imperative
// API and a reactive `useAppState()` signal — @sigx/reactivity is a zero-dep
// leaf, so depending on it here is cycle-free and cheap.

/** The core native module (`SigxCore`) — same one DeviceInfo hangs off. */
const MODULE = 'SigxCore';

/**
 * Global event fired by the native side (iOS `AppStatePublisher.swift`,
 * Android via `SigxActivityHook` → `AppStateBus`) through `GlobalEventEmitter`
 * on every foreground/background transition. Payload: `{ state }`.
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
                // Transitions between an earlier successful seed and this
                // (possibly late) wiring were never delivered — force a
                // one-time re-seed to sync to the native state. On the normal
                // path (wiring succeeds on the first call) the seed hasn't run
                // yet, so this is a no-op.
                seeded = false;
            }
        } catch {
            // getJSModule threw — retry on the next API call.
        }
    }

    // Authoritative seed for the rare background boot (e.g. launched by the
    // OS while backgrounded). Fire-and-forget: the default 'active' is right
    // for every ordinary launch. A transient failure resets the latch so a
    // later API call retries instead of trusting the default forever.
    if (!seeded && isModuleAvailable(MODULE)) {
        seeded = true;
        void callAsync<{ state?: unknown }>(MODULE, 'getAppState')
            .then((res) => {
                // The bridge resolves whatever the native callback passes —
                // an error-shaped or malformed payload is a failure too.
                if (isStatus(res?.state)) dispatch(res.state);
                else seeded = false;
            })
            .catch(() => { seeded = false; });
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

/** Whether the native app-state channel is available (false off-device). */
export function isAppStateAvailable(): boolean {
    return isModuleAvailable(MODULE);
}
