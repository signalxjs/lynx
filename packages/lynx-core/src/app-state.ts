import { signal, computed, watch, type Computed } from '@sigx/reactivity';
import { callAsync, isModuleAvailable } from './bridge.js';
import { isNativeEventsAvailable, subscribeNative } from './events.js';

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

/** Payload of the `appStateChanged` global event. */
interface AppStateEvent {
    state: AppStateStatus;
}

// The single source of truth. An OBJECT signal (not a primitive one): its
// `.status` keeps the `AppStateStatus` union type, whereas a PrimitiveSignal
// widens `.value` to `string`. JS boots with the app foregrounded in every
// ordinary launch; the async native seed (below) corrects the rare background
// boot. Everything downstream — `AppState.current`, `AppState.subscribe`, and
// the reactive `useAppState()` — derives from this one signal, so we lean on
// the reactivity system's own subscription + Object.is dedup instead of a
// hand-rolled listener set.
const state = signal({ status: 'active' as AppStateStatus });
let emitterWired = false;
let seeded = false;
let stateComputed: Computed<AppStateStatus> | undefined;

const isStatus = (v: unknown): v is AppStateStatus => v === 'active' || v === 'background';

const isAppStateEvent = (raw: unknown): raw is AppStateEvent =>
    !!raw && typeof raw === 'object' && isStatus((raw as { state?: unknown }).state);

/**
 * Wire the native event subscription + native seed, lazily. Each latch is
 * gated on the emitter being REACHABLE (same pattern as lynx-http's
 * `ensureSubscribed`): if the first API call races runtime init and there is
 * no emitter yet, a later call retries instead of leaving the module
 * permanently unwired. Off-device (web preview, SSR, tests) the probe never
 * passes — a silent no-op.
 *
 * "Reachable" is as strong a guarantee as is available here, and deliberately
 * weaker than "attached": `subscribeNative` hands back an indistinguishable
 * no-op disposer both off-device and when a half-initialised host's
 * `addListener` throws, so nothing it returns can confirm the listener really
 * landed. A host that accepts the emitter lookup and then throws on
 * `addListener` therefore latches un-listened rather than retrying — it is
 * logged, and treating a broken emitter as permanently broken beats retrying
 * it on every read.
 *
 * The subscription is process-lifetime by design — this is an ambient
 * singleton, like `Platform`, with no teardown in its public surface — so the
 * disposer is deliberately dropped. C7 idempotence still matters for
 * `AppState.subscribe`, the disposer consumers do hold.
 */
const ensureWired = (): void => {
    if (!emitterWired && isNativeEventsAvailable()) {
        subscribeNative<AppStateEvent>(
            APP_STATE_EVENT,
            // A subscriber that throws is contained by `subscribeNative`
            // rather than escaping into the native dispatch, where it would
            // abort delivery to every other listener on this channel.
            (e) => { state.status = e.state; },   // signal dedups
            { validate: isAppStateEvent, namespace: 'lynx-core' },
        );
        emitterWired = true;
        // Transitions between an earlier successful seed and this (possibly
        // late) wiring were never delivered — force a one-time re-seed to sync
        // to the native state. On the normal path (wiring succeeds on the
        // first call) the seed hasn't run yet, so this is a no-op.
        seeded = false;
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
                if (isStatus(res?.state)) state.status = res.state;
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
        return state.status;
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
        return watch(() => state.status, (next) => cb(next));
    },
};

/**
 * Reactive read of the app state — a lazily-created singleton `Computed`.
 * Components reading `.value` re-render on foreground/background transitions.
 * Read-only by design; drive changes from the native lifecycle, not JS.
 */
export function useAppState(): Computed<AppStateStatus> {
    ensureWired();
    if (!stateComputed) stateComputed = computed(() => state.status);
    return stateComputed;
}
