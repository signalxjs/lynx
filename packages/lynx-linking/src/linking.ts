import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Linking';
const URL_EVENT = 'urlReceived';
const GLOBAL_PROPS_KEY = 'initialURL';

export interface URLEvent {
    url: string;
}

export type URLListener = (event: URLEvent) => void;

export interface URLSubscription {
    remove(): void;
}

interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    __globalProps?: { [k: string]: unknown };
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

// Closure-injected identifier provided by
// `@lynx-js/runtime-wrapper-webpack-plugin`'s `__init_card_bundle__`
// wrapper. Same pattern as `@sigx/lynx-safe-area/src/globals.ts` and
// `@sigx/lynx-runtime/src/bg-bridge.ts`. Access as a bare identifier with
// `typeof` guard so this module also works in tests / SSR / non-Lynx hosts.
declare const lynx: unknown | undefined;

function lynxObj(): LynxLike | undefined {
    return typeof lynx !== 'undefined' ? (lynx as unknown as LynxLike) : undefined;
}

/**
 * Deep link & URL handling APIs.
 *
 * Outbound calls (`openURL`, `canOpenURL`) cross the Lynx bridge to a
 * standard `LinkingModule`. Inbound URL delivery uses Lynx's
 * framework-blessed `GlobalEventEmitter` + `__globalProps` channels — the
 * native `LinkingPublisher` (a per-LynxView lifecycle publisher) writes
 * `lynx.__globalProps.initialURL` and fires `sendGlobalEvent("urlReceived",
 * [url])`. This mirrors the pattern used by `@sigx/lynx-safe-area` and
 * avoids long-lived bridge callbacks.
 *
 * @example
 * ```ts
 * import { Linking } from '@sigx/lynx-linking';
 *
 * await Linking.openURL('https://lynxjs.org');
 *
 * const initial = Linking.getInitialURL();   // sync read from __globalProps
 * if (initial) handle(initial);
 *
 * const sub = Linking.addEventListener('url', ({ url }) => handle(url));
 * // later: sub.remove();
 * ```
 */
export const Linking = {
    /** Open a URL using the system handler (browser, mail client, dialer). */
    openURL(url: string): Promise<void> {
        return callAsync<void>(MODULE, 'openURL', url);
    },

    /** Whether the runtime can open a URL with the given scheme. */
    canOpenURL(url: string): Promise<boolean> {
        return callAsync<boolean>(MODULE, 'canOpenURL', url);
    },

    /**
     * URL the app was launched with, or null. Read synchronously from
     * `lynx.__globalProps.initialURL` — no bridge round-trip. Returns the
     * latest URL the publisher has seen, so this is also a fine source for
     * "what was the most recent deep link" queries.
     */
    getInitialURL(): string | null {
        const raw = lynxObj()?.__globalProps?.[GLOBAL_PROPS_KEY];
        return typeof raw === 'string' && raw.length > 0 ? raw : null;
    },

    /**
     * Subscribe to incoming URL events. Wraps Lynx's `GlobalEventEmitter`,
     * which is fed by the native `LinkingPublisher` via `sendGlobalEvent`.
     */
    addEventListener(type: 'url', listener: URLListener): URLSubscription {
        if (type !== 'url') {
            throw new Error(`[@sigx/lynx-linking] Unknown event type: ${String(type)}`);
        }
        const emitter = lynxObj()?.getJSModule?.('GlobalEventEmitter');
        if (!emitter) {
            return { remove() {} };
        }
        const wrapped = (raw: unknown) => {
            const url = typeof raw === 'string' ? raw : '';
            if (url) listener({ url });
        };
        emitter.addListener(URL_EVENT, wrapped);
        return {
            remove: () => emitter.removeListener(URL_EVENT, wrapped),
        };
    },

    /** Whether the bridge module is registered in the current build. */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
