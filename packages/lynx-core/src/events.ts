/**
 * subscribeNative — the one native → JS event subscription for every
 * `@sigx/lynx-*` package (convention C7).
 *
 * Sixteen files used to re-declare this shim, each re-deriving the same four
 * edge cases: the emitter has to be fetched through `lynx.getJSModule`, the
 * payload can arrive as a JSON *string* rather than an object, a listener that
 * throws must not take the emitter down with it, and off-device (web preview,
 * SSR, tests) there is no emitter at all. Getting any one of them wrong is a
 * bug that only shows up on a device, so they belong in one place.
 *
 * Returns an unsubscribe function, never a `{ remove() }` object — that is C7,
 * and it makes the disposer directly usable as an effect cleanup.
 */
import { createLogger } from './logger.js';

const log = createLogger('core:events');

/** The subset of Lynx's GlobalEventEmitter this module needs. */
interface GlobalEventEmitterLike {
    addListener: (name: string, fn: (...a: unknown[]) => void) => void;
    removeListener: (name: string, fn: (...a: unknown[]) => void) => void;
}

interface LynxLike {
    getJSModule?: (name: string) => GlobalEventEmitterLike | undefined;
}

declare const lynx: unknown | undefined;

/**
 * The runtime's shared event emitter, or `undefined` off-device.
 *
 * Resolved per call rather than cached: the emitter is injected by the Lynx
 * runtime and a cached `undefined` from an early import would strand every
 * later subscriber.
 */
function emitter(): GlobalEventEmitterLike | undefined {
    if (typeof lynx === 'undefined') return undefined;
    try {
        return (lynx as LynxLike).getJSModule?.('GlobalEventEmitter');
    } catch {
        // A host that injects a partial `lynx` global shouldn't crash an
        // import-time subscription.
        return undefined;
    }
}

function safeParse(s: string): unknown {
    try {
        return JSON.parse(s);
    } catch {
        return undefined;
    }
}

export interface SubscribeNativeOptions<T> {
    /**
     * Payload guard. Events failing it are dropped rather than delivered as a
     * malformed `T` — native payload shapes have drifted before (#342), and a
     * listener typed `(e: T) => void` should be able to trust its argument.
     *
     * Without a guard the parsed payload is passed through unchecked.
     */
    validate?: (raw: unknown) => raw is T;
    /**
     * Namespace for the "listener threw" diagnostic. Defaults to the channel
     * name; pass the package's own namespace so the warning is greppable and
     * routes through the same logger the rest of the package uses (C10).
     */
    namespace?: string;
}

/**
 * Subscribe to a native event channel.
 *
 * Off-device this is a safe no-op returning a no-op disposer, so a package can
 * subscribe unconditionally at import or mount time without branching on
 * availability.
 *
 * @param channel the `GlobalEventEmitter` channel name, e.g. `'__sigxAppState'`
 * @param cb called with each valid payload
 * @returns unsubscribe; calling it more than once is a no-op
 */
export function subscribeNative<T = unknown>(
    channel: string,
    cb: (event: T) => void,
    options: SubscribeNativeOptions<T> = {},
): () => void {
    const e = emitter();
    if (!e) return () => {};

    const { validate, namespace = channel } = options;

    const wrapped = (raw: unknown) => {
        const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
        if (parsed === undefined) return;
        if (validate && !validate(parsed)) return;
        try {
            cb(parsed as T);
        } catch (err) {
            // One listener's bug must not unsubscribe the others or propagate
            // into the native dispatch.
            log.warn(`[${namespace}] listener for ${channel} threw`, err);
        }
    };

    e.addListener(channel, wrapped);

    // Idempotent per C7: an effect cleanup can fire twice (unmount plus an
    // explicit teardown), and `removeListener` on an already-removed handler
    // is not guaranteed to be harmless on every host.
    let removed = false;
    return () => {
        if (removed) return;
        removed = true;
        try {
            e.removeListener(channel, wrapped);
        } catch (err) {
            log.warn(`[${namespace}] removeListener for ${channel} threw`, err);
        }
    };
}
