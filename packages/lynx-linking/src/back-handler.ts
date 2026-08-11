import { callAsync, unwrapNativeVoid } from '@sigx/lynx-core';

import { subscribeRawNative } from './native-event.js';

const MODULE = 'Linking';
const PKG = 'lynx-linking';
const BACK_EVENT = 'hardwareBackPress';

/**
 * Unsubscribe function returned by `BackHandler.addEventListener` (C7).
 *
 * Calling it unsubscribes; calling it twice is a no-op. Was an RN-style
 * `{ remove(): void }` object through 0.27.0 — see the README.
 */
export type BackHandlerSubscription = () => void;

/**
 * Hardware back button + app-level back UX.
 *
 * Android-only. The native side hooks into `MainActivity.onBackPressed` and
 * dispatches into `BackHandlerState`, whose registered subscribers each call
 * `lynx.sendGlobalEvent('hardwareBackPress', ...)`. JS subscribers receive
 * the event via `GlobalEventEmitter` and decide whether to handle it
 * (typically: pop a navigator) or escalate to `exitApp()`.
 *
 * iOS doesn't have a hardware back button, so `addEventListener` is a no-op
 * (the listener never fires) and `exitApp()` always rejects — App Store
 * Review Guidelines explicitly forbid programmatic app termination on iOS.
 *
 * @example
 * ```ts
 * import { BackHandler } from '@sigx/lynx-linking';
 *
 * const off = BackHandler.addEventListener(() => {
 *     if (router.canGoBack) { router.pop(); return true; }
 *     return false; // not handled — let exitApp escalation happen
 * });
 *
 * // At the root, if no listener handles, fall back to exiting. Consume the
 * // rejection — an unhandled one is fatal on Lynx, not a warning.
 * BackHandler.exitApp().catch(() => {
 *     // rejects on iOS, and on Android with no hosting Activity
 * });
 *
 * // Cleanup on unmount:
 * off();
 * ```
 */
export const BackHandler = {
    /**
     * Subscribe to hardware-back-press events. Listener returns `true` to
     * indicate the press was handled (so subsequent listeners can skip it).
     * Currently the return value is informational only — native always treats
     * the press as consumed when at least one subscriber is registered.
     *
     * @returns unsubscribe; calling it twice is a no-op (C7).
     */
    addEventListener(listener: () => boolean | void): BackHandlerSubscription {
        // The press carries no payload — `subscribeRawNative` hands the
        // listener whatever native sent (nothing) and contains a throw so a
        // broken handler can't cost sibling subscribers their event.
        return subscribeRawNative(BACK_EVENT, () => {
            listener();
        });
    },

    /**
     * Send the foreground task to the back of the activity stack on Android
     * (the standard "back-out at root" behavior — keeps the bundle warm for
     * instant resume).
     *
     * Rejects with a `SigxError` (`code: 'native_error'`) when native refused:
     * always on iOS, which doesn't permit programmatic termination, and on
     * Android when no hosting Activity could be found. Both arrive as the
     * `{ error }` envelope on the resolved callback, so this used to resolve
     * as if the app had backed out (C4). Callers that fire and forget must
     * consume the rejection — see the example above.
     */
    async exitApp(): Promise<void> {
        unwrapNativeVoid(
            PKG,
            'exitApp',
            await callAsync<{ error?: string } | null>(MODULE, 'exitApp'),
        );
    },
} as const;
