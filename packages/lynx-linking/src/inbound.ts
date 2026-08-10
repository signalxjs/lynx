/**
 * Inbound URL delivery — shared by the native (`linking.ts`) and web
 * (`linking.web.ts`) implementations. Both platforms feed the same
 * framework-blessed channels: a publisher writes
 * `lynx.__globalProps.initialURL` and fires `sendGlobalEvent('urlReceived',
 * [url])` (native `LinkingPublisher`; on web `@sigx/lynx-web-host`'s
 * linking publisher), so the readers here are platform-independent.
 *
 * The subscription itself lives in `native-event.ts` — one shim for the whole
 * package, shared with `back-handler.ts`.
 */
import { subscribeRawNative } from './native-event.js';

export const URL_EVENT = 'urlReceived';
export const GLOBAL_PROPS_KEY = 'initialURL';

export interface URLEvent {
    url: string;
}

export type URLListener = (event: URLEvent) => void;

/**
 * Unsubscribe function returned by `Linking.addEventListener` (C7).
 *
 * Calling it unsubscribes; calling it twice is a no-op. Was an RN-style
 * `{ remove(): void }` object through 0.27.0 — see the README.
 */
export type URLSubscription = () => void;

interface LynxLike {
    __globalProps?: { [k: string]: unknown };
}

// Closure-injected identifier provided by
// `@lynx-js/runtime-wrapper-webpack-plugin`'s `__init_card_bundle__`
// wrapper (worker global on web). `typeof`-guarded so this module also works
// in tests / SSR / non-Lynx hosts.
declare const lynx: unknown | undefined;

function lynxObj(): LynxLike | undefined {
    return typeof lynx !== 'undefined' ? (lynx as unknown as LynxLike) : undefined;
}

/** Latest URL the publisher has seen (`__globalProps.initialURL`), or null. */
export function readInitialURL(): string | null {
    const raw = lynxObj()?.__globalProps?.[GLOBAL_PROPS_KEY];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Payload guard for `urlReceived`.
 *
 * The publishers push the URL as a bare string (`sendGlobalEvent(URL_EVENT,
 * [url])`), so anything else — or an empty string from a publisher that lost
 * the URL — is dropped rather than delivered as an event carrying `url: ''`,
 * which a router would happily try to navigate to.
 */
function isURLPayload(raw: unknown): raw is string {
    return typeof raw === 'string' && raw.length > 0;
}

/**
 * Subscribe to `urlReceived` events on Lynx's `GlobalEventEmitter`.
 *
 * @returns unsubscribe; calling it twice is a no-op (C7).
 */
export function subscribeUrl(listener: URLListener): URLSubscription {
    return subscribeRawNative(URL_EVENT, (raw) => {
        if (!isURLPayload(raw)) return;
        listener({ url: raw });
    });
}
