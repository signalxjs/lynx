import { callAsync, isModuleAvailable, SigxError, unwrapNativeVoid } from '@sigx/lynx-core';

import { readInitialURL, subscribeUrl } from './inbound.js';
import type { URLListener, URLSubscription } from './inbound.js';

const MODULE = 'Linking';
const PKG = 'lynx-linking';

// Inbound types live in `inbound.ts` (shared with `linking.web.ts`); re-export
// so `index.ts` and existing consumers keep their import site.
export type { URLEvent, URLListener, URLSubscription } from './inbound.js';

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
 * const off = Linking.addEventListener('url', ({ url }) => handle(url));
 * // later: off();
 * ```
 */
export const Linking = {
    /**
     * Open a URL using the system handler (browser, mail client, dialer).
     *
     * Rejects with a `SigxError` (`code: 'native_error'`) when the OS refused
     * to open it — no installed app handles the scheme, or the URL is
     * malformed. Native reports that on the *resolved* callback as
     * `{ error }`, so without the unwrap `await openURL(x)` succeeded whether
     * or not anything happened, and the try-the-deep-link/fall-back-to-https
     * pattern was dead code (C4).
     */
    async openURL(url: string): Promise<void> {
        unwrapNativeVoid(
            PKG,
            'openURL',
            await callAsync<{ error?: string } | null>(MODULE, 'openURL', url),
        );
    },

    /**
     * Whether the runtime can open a URL with the given scheme.
     *
     * `false` is an answer, not a failure — both platforms resolve a plain
     * boolean and never the `{ error }` envelope (they fall back to `false`
     * for a malformed URL), so there is nothing to unwrap here.
     */
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
        return readInitialURL();
    },

    /**
     * Subscribe to incoming URL events. Wraps Lynx's `GlobalEventEmitter`,
     * which is fed by the native `LinkingPublisher` via `sendGlobalEvent`.
     *
     * @returns unsubscribe; calling it twice is a no-op (C7).
     */
    addEventListener(type: 'url', listener: URLListener): URLSubscription {
        if (type !== 'url') {
            throw new SigxError(
                PKG,
                'unsupported_event',
                `[@sigx/${PKG}] addEventListener failed: unknown event type "${String(type)}"`,
            );
        }
        return subscribeUrl(listener);
    },

    /** Whether the bridge module is registered in the current build. */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
