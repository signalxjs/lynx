import { signal, computed, watch, type Computed } from '@sigx/reactivity';
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

/** Listener signature for {@link AppState.subscribe}. */
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

// The single source of truth. JS boots with the app foregrounded in every
// ordinary launch; the async native seed (below) corrects the rare background
// boot. Everything downstream — `AppState.current`, `AppState.subscribe`, and
// the reactive `useAppState()` — derives from this one signal, so we lean on
// the reactivity system's own subscription + Object.is dedup instead of a
// hand-rolled listener set.
const state = signal<AppStateStatus>('active');
let emitterWired = false;
let seeded = false;
let stateComputed: Computed<AppStateStatus> | undefined;

const isStatus = (v: unknown): v is AppStateStatus => v === 'active' || v === 'background';

// PrimitiveSignal widens its value type to `string` (sigx lets you reassign any
// string later); every write here is isStatus-guarded, so reading back as
// AppStateStatus is sound.
const read = (): AppStateStatus => state.value as AppStateStatus;

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
                    const next = (payload as { state?: unknown } | undefined)?.state;
                    if (isStatus(next)) state.value = next;   // signal dedups
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
                if (isStatus(res?.state)) state.value = res.state;
                else seeded = false;
            })
            .catch(() => { seeded = false; });
    }
};

/**
 * App foreground/background state — the imperative/ambient surface, shaped like
 * core's other ambient services (`Platform`, `DeviceInfo`). For reactive reads
 * in a component, use {@link useAppState} instead.
 */
export const AppState = {
    /**
     * Current state, read synchronously (live). `'active'` until the first
     * transition — including off-device (web preview, SSR, tests), where no
     * events ever fire.
     */
    get current(): AppStateStatus {
        ensureWired();
        return read();
    },

    /** Whether the native app-state channel is available (false off-device). */
    get available(): boolean {
        return isModuleAvailable(MODULE);
    },

    /**
     * Subscribe to foreground/background transitions. The callback fires on
     * every change (never for consecutive duplicates — the signal dedups via
     * Object.is). Returns an unsubscribe function. Off-device this is a safe
     * no-op — the underlying signal never changes.
     *
     * Thin wrapper over the reactivity system's `watch` (synchronous, fires on
     * change only), so imperative subscribers and reactive consumers share one
     * subscription mechanism.
     */
    subscribe(cb: AppStateListener): () => void {
        ensureWired();
        return watch(read, (next) => cb(next));
    },
};

/**
 * Reactive read of the app state — a lazily-created singleton `Computed`.
 * Components reading `.value` re-render on foreground/background transitions.
 * Read-only by design; drive changes from the native lifecycle, not JS.
 */
export function useAppState(): Computed<AppStateStatus> {
    ensureWired();
    if (!stateComputed) stateComputed = computed(read);
    return stateComputed;
}
