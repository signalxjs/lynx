/**
 * Back interceptors (#1290) — who gets a back press before navigation does.
 *
 * The Android hardware back button (and the back gesture) reaches JS as one
 * `hardwareBackPress` event, which `@sigx/lynx-navigation` turns into a pop.
 * But a back press should first close whatever sits ON TOP of the screen: an
 * open dialog, drawer, menu or combobox. Those live in packages that must not
 * depend on navigation (it is an optional peer), so the contract lives here,
 * in the one package everything shares:
 *
 * - an overlay layer calls `addBackInterceptor()` while it is open;
 * - the back wiring calls `dispatchBackInterceptors()` first, and pops only
 *   when no interceptor consumed the press.
 *
 * Interceptors run newest first, and the first that returns `true` consumes
 * the press. Pure JS, no native side: iOS never fires a back press, so
 * nothing calls the dispatcher there.
 */
import { createLogger } from './logger.js';

const log = createLogger('lynx-core');

/** Return `true` when the press was handled (nothing further may act on it). */
export type BackInterceptor = () => boolean;

const interceptors: BackInterceptor[] = [];

/**
 * Register a back interceptor. Newer interceptors run first — the one
 * registered last is the one on top.
 *
 * @returns unsubscribe; calling it twice is a no-op (C7)
 */
export function addBackInterceptor(interceptor: BackInterceptor): () => void {
    // A wrapper, so the same function registered twice unregisters one entry.
    const entry: BackInterceptor = () => interceptor();
    interceptors.push(entry);
    return () => {
        const index = interceptors.indexOf(entry);
        if (index !== -1) interceptors.splice(index, 1);
    };
}

/**
 * Offer a back press to the interceptors, newest first. Returns `true` when
 * one consumed it — the caller must then not navigate. A throwing
 * interceptor is logged and skipped, so it cannot swallow the press or cost
 * the ones below it their turn.
 */
export function dispatchBackInterceptors(): boolean {
    // A snapshot: an interceptor that unregisters itself (a layer closing)
    // must not shift the walk.
    const snapshot = interceptors.slice();
    for (let i = snapshot.length - 1; i >= 0; i--) {
        try {
            if (snapshot[i]()) return true;
        } catch (err) {
            log.warn('back interceptor threw', err);
        }
    }
    return false;
}
