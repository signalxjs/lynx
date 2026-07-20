/**
 * Inbound URL delivery — shared by the native (`linking.ts`) and web
 * (`linking.web.ts`) implementations. Both platforms feed the same
 * framework-blessed channels: a publisher writes
 * `lynx.__globalProps.initialURL` and fires `sendGlobalEvent('urlReceived',
 * [url])` (native `LinkingPublisher`; on web `@sigx/lynx-web-host`'s
 * linking publisher), so the readers here are platform-independent.
 */

export const URL_EVENT = 'urlReceived';
export const GLOBAL_PROPS_KEY = 'initialURL';

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

/** Subscribe to `urlReceived` events on Lynx's `GlobalEventEmitter`. */
export function subscribeUrl(listener: URLListener): URLSubscription {
    const emitter = lynxObj()?.getJSModule?.('GlobalEventEmitter');
    if (!emitter) {
        return { remove() {} };
    }
    const wrapped = (raw: unknown): void => {
        const url = typeof raw === 'string' ? raw : '';
        if (url) listener({ url });
    };
    emitter.addListener(URL_EVENT, wrapped);
    return {
        remove: () => emitter.removeListener(URL_EVENT, wrapped),
    };
}
