import { callAsync } from '@sigx/lynx-core';

const MODULE = 'Linking';
const BACK_EVENT = 'hardwareBackPress';

export interface BackHandlerSubscription {
    remove(): void;
}

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

function lynxObj(): LynxLike | undefined {
    return typeof lynx !== 'undefined' ? (lynx as unknown as LynxLike) : undefined;
}

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
 * (the listener never fires) and `exitApp()` is a no-op too — App Store
 * Review Guidelines explicitly forbid programmatic app termination on iOS.
 *
 * @example
 * ```ts
 * import { BackHandler } from '@sigx/lynx-linking';
 *
 * const sub = BackHandler.addEventListener(() => {
 *     if (router.canGoBack) { router.pop(); return true; }
 *     return false; // not handled — let exitApp escalation happen
 * });
 *
 * // At the root, if no listener handles, fall back to exiting:
 * BackHandler.exitApp();
 *
 * // Cleanup on unmount:
 * sub.remove();
 * ```
 */
export const BackHandler = {
    /**
     * Subscribe to hardware-back-press events. Listener returns `true` to
     * indicate the press was handled (so subsequent listeners can skip it).
     * Currently the return value is informational only — native always treats
     * the press as consumed when at least one subscriber is registered.
     */
    addEventListener(listener: () => boolean | void): BackHandlerSubscription {
        const emitter = lynxObj()?.getJSModule?.('GlobalEventEmitter');
        if (!emitter) {
            // No emitter available (web/SSR/test) — return a no-op subscription
            // so callers don't need to branch.
            return { remove() {} };
        }
        const wrapped = () => {
            try {
                listener();
            } catch (e) {
                // Don't let a JS handler crash propagate back through the
                // emitter and break sibling subscribers.
                // eslint-disable-next-line no-console
                console.warn('[BackHandler] listener threw:', e);
            }
        };
        emitter.addListener(BACK_EVENT, wrapped);
        return {
            remove: () => emitter.removeListener(BACK_EVENT, wrapped),
        };
    },

    /**
     * Send the foreground task to the back of the activity stack on Android
     * (the standard "back-out at root" behavior — keeps the bundle warm for
     * instant resume). On iOS this rejects with an error since iOS doesn't
     * permit programmatic termination.
     */
    exitApp(): Promise<void> {
        return callAsync<void>(MODULE, 'exitApp');
    },
} as const;
