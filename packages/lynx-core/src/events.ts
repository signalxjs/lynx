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

/**
 * Whether the runtime's `GlobalEventEmitter` is reachable right now.
 *
 * Most packages never need this: {@link subscribeNative} is a silent no-op
 * off-device, so a subscribe-once-and-forget module can just subscribe. It
 * exists for the *lazy-latch* pattern — modules that wire on the first API
 * call and must retry until the emitter appears, because that first call can
 * race runtime init (core's app-state / font-scale / screen, lynx-http's
 * `ensureSubscribed`). Those need to know whether the subscription actually
 * attached, and answering that from the disposer is impossible: the no-op
 * disposer returned off-device is indistinguishable from a real one.
 *
 * Without this they would each re-derive the `lynx.getJSModule` lookup this
 * module exists to own — which is exactly how sixteen copies happened.
 */
export function isNativeEventsAvailable(): boolean {
    return emitter() !== undefined;
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
    /**
     * Deliver the payload exactly as native sent it: no JSON parse, and no
     * drop when it is `undefined`.
     *
     * The default suits the common case — a JSON object that may arrive as a
     * string — but two real channels are neither. `@sigx/lynx-linking`'s
     * `urlReceived` sends the URL as a **bare string** (`sendGlobalEvent
     * ("urlReceived", [url])`), which the default treats as JSON and drops
     * when `JSON.parse` throws, silently swallowing every warm-start deep
     * link; and `hardwareBackPress` carries **no payload at all**, which the
     * default drops before reaching the callback, killing the Android back
     * button. Both were found migrating that package onto this helper.
     *
     * `validate` still runs when supplied, so a raw channel can be typed too.
     */
    raw?: boolean;
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

    const { validate, namespace = channel, raw: rawMode = false } = options;

    // The logger is built from the caller's namespace, not this module's, so a
    // package's subscription diagnostics land on the same namespace as the rest
    // of its logging (C10) — which is what `namespace` has always promised.
    // `createLogger` just builds an object, so one per subscription is free.
    const log = createLogger(namespace);

    const wrapped = (raw: unknown) => {
        const parsed = rawMode ? raw : typeof raw === 'string' ? safeParse(raw) : raw;
        if (!rawMode && parsed === undefined) return;
        if (validate && !validate(parsed)) return;
        try {
            cb(parsed as T);
        } catch (err) {
            // One listener's bug must not unsubscribe the others or propagate
            // into the native dispatch.
            log.warn(`listener for ${channel} threw`, err);
        }
    };

    try {
        e.addListener(channel, wrapped);
    } catch (err) {
        // A host with a partial or hostile emitter must not take the caller
        // down. Several packages wire their subscription lazily behind a latch
        // on first API read, so a throw here surfaced as `AppState.current` or
        // `useScreen()` throwing — and permanently, since the latch never set.
        // Returning a no-op disposer degrades to the off-device behaviour above.
        log.warn(`addListener for ${channel} threw`, err);
        return () => {};
    }

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
            log.warn(`removeListener for ${channel} threw`, err);
        }
    };
}
