/**
 * Shared event plumbing for the WebRTC module.
 *
 * Native pushes a single `__sigxWebRTCEvent` global event carrying
 * `{ id, type, ... }`; one listener, registered through core's
 * `subscribeNative` (C7), demultiplexes by numeric id to the entity
 * (peer connection, data channel, or track) that owns it.
 *
 * The subscription used to be a local `GlobalEventEmitter` shim. It isn't
 * because the shim missed the case that matters for a demux: a dispatcher that
 * throws — a corrupt base64 body, a payload field of the wrong type — escaped
 * into the emitter's dispatch loop and took every *other* listener on the
 * channel with it. `subscribeNative` isolates the callback and drops malformed
 * payloads via {@link isNativeEvent}.
 *
 * Id scheme: JS-created entities (peers, local tracks, local data
 * channels) draw positive ids from `allocId()`. Native-created entities
 * (remote tracks, remote data channels) carry negative ids allocated by
 * the native side — globally unique with zero coordination, so the demux
 * stays a single map.
 */
import { isNativeEventsAvailable, subscribeNative } from '@sigx/lynx-core';
import { WebRTCError, log } from './errors.js';

const MODULE = 'WebRTC';
const EVENT_NAME = '__sigxWebRTCEvent';

export { MODULE, EVENT_NAME };

/** Wire payload pushed by the native side. */
export interface NativeEvent {
    id: number;
    type:
        | 'connectionstatechange'
        | 'iceconnectionstatechange'
        | 'icegatheringstatechange'
        | 'signalingstatechange'
        | 'icecandidate'
        | 'track'
        | 'datachannel'
        | 'dcopen'
        | 'dcmessage'
        | 'dcclose'
        | 'dcerror'
        | 'trackended'
        | 'trackmuted'
        | 'trackunmuted';
    /** State string for *statechange events. */
    state?: string;
    /** Current local SDP, piggy-backed on icegatheringstatechange. */
    sdpType?: string;
    sdp?: string;
    /** ICE candidate fields (null candidate = end of candidates). */
    candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null;
    /** Remote track fields. */
    trackId?: number;
    trackKind?: string;
    trackLabel?: string;
    streamIds?: string[];
    muted?: boolean;
    /** Remote data channel fields. */
    dcId?: number;
    label?: string;
    protocol?: string;
    ordered?: boolean;
    /** SCTP stream id, delivered on `datachannel` and `dcopen`. */
    sctpId?: number;
    /** Data channel message fields. */
    data?: string;
    binary?: string;
    isBinary?: boolean;
    /** Error message for dcerror. */
    message?: string;
}

type Dispatcher = (evt: NativeEvent) => void;

const dispatchers = new Map<number, Dispatcher>();
let nextId = 1;
let unsubscribe: (() => void) | null = null;

/** Allocate a JS-side (positive) entity id. */
export function allocId(): number {
    return nextId++;
}

export function registerDispatcher(id: number, fn: Dispatcher): void {
    dispatchers.set(id, fn);
}

export function unregisterDispatcher(id: number): void {
    dispatchers.delete(id);
}

/**
 * Payload guard for the demux channel.
 *
 * `id` is how an event finds its entity and `type` is the switch every
 * dispatcher runs on, so a payload missing either can't be acted on — dropping
 * it here keeps the guard in one place instead of re-checking in three
 * `_dispatch` implementations. (Native has drifted before; a dispatcher typed
 * `(evt: NativeEvent)` should be able to trust its argument.)
 */
function isNativeEvent(raw: unknown): raw is NativeEvent {
    if (typeof raw !== 'object' || raw === null) return false;
    const e = raw as Partial<NativeEvent>;
    return typeof e.id === 'number' && typeof e.type === 'string';
}

/**
 * @internal The package's single native subscription (C7) — core's
 * `subscribeNative` handles the emitter lookup, the JSON-string payload form,
 * off-device absence, and isolating a listener that throws.
 *
 * @returns unsubscribe; calling it more than once is a no-op.
 */
export function subscribeToNativeEvents(cb: (evt: NativeEvent) => void): () => void {
    return subscribeNative<NativeEvent>(EVENT_NAME, cb, {
        validate: isNativeEvent,
        namespace: 'lynx-webrtc',
    });
}

/**
 * Attach the demux listener once, on the first peer/track created.
 *
 * One listener serves the whole module for the lifetime of the JS context —
 * entities come and go from `dispatchers`, the subscription does not.
 *
 * The latch is keyed on `isNativeEventsAvailable()`, not on having called
 * `subscribeNative` once. A peer can be constructed before the Lynx runtime
 * has injected its `GlobalEventEmitter`, and `subscribeNative` is a silent
 * no-op then, returning a disposer indistinguishable from a real one — so
 * latching on the call itself would deafen the whole module for the rest of
 * the process. Off-device (web preview, SSR, tests) the probe stays false and
 * nothing is wired, which is the same outcome by the intended route.
 */
export function ensureSubscribed(): void {
    if (unsubscribe) return;
    if (!isNativeEventsAvailable()) return;
    unsubscribe = subscribeToNativeEvents(evt => {
        dispatchers.get(evt.id)?.(evt);
    });
}

/**
 * Unwrap a native callback result for `action`: `{ error, errorName? }` throws
 * a {@link WebRTCError} whose `name`/`code` mirror the DOMException name
 * browsers throw (e.g. `NotAllowedError` for a denied microphone prompt).
 * Native omits `errorName` for failures with no W3C equivalent — the spec's
 * generic for those is `OperationError`.
 */
export function unwrap<T>(action: string, result: unknown): T {
    const err = (result as { error?: unknown } | null)?.error;
    if (typeof err === 'string') {
        const name = (result as { errorName?: unknown }).errorName;
        const code = typeof name === 'string' && name.length > 0 ? name : 'OperationError';
        throw new WebRTCError(code, action, err, { cause: result });
    }
    return result as T;
}

/** `unwrap` bound to `action`, for the `.then(…)` of a fire-and-forget call. */
export const unwrapFor =
    (action: string) =>
    (result: unknown): void => {
        unwrap(action, result);
    };

/** Minimal event shape fired at handlers — enough for portable WebRTC code. */
export interface RTCEventLike {
    type: string;
    target: unknown;
    currentTarget: unknown;
    [key: string]: unknown;
}

export type EventListenerLike =
    | ((ev: RTCEventLike) => void)
    | { handleEvent(ev: RTCEventLike): void };

/**
 * Shared `EventTarget`-ish base: `on<type>` handler slots plus
 * add/removeEventListener, with handler exceptions isolated so one bad
 * listener can't break dispatch.
 */
export class RTCEventTargetBase {
    private readonly _listeners: Record<string, Set<EventListenerLike>> = Object.create(null);

    addEventListener(type: string, listener: EventListenerLike): void {
        if (!listener) return;
        (this._listeners[type] ??= new Set()).add(listener);
    }

    removeEventListener(type: string, listener: EventListenerLike): void {
        this._listeners[type]?.delete(listener);
    }

    dispatchEvent(event: RTCEventLike): boolean {
        this._emit(event.type, event);
        return true;
    }

    /** @internal — fire `on<type>` slot + addEventListener subscribers. */
    protected _emit(type: string, event: RTCEventLike): void {
        const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
        if (typeof handler === 'function') {
            try {
                (handler as (e: RTCEventLike) => void).call(this, event);
            } catch (e) {
                log.warn(`on${type} handler threw`, e);
            }
        }
        const set = this._listeners[type];
        if (set) {
            for (const listener of set) {
                try {
                    if (typeof listener === 'function') listener.call(this, event);
                    else listener.handleEvent(event);
                } catch (e) {
                    log.warn(`'${type}' listener threw`, e);
                }
            }
        }
    }
}

// Test-only escape hatch: reachable from unit tests, tree-shakeable.
/** @internal */
export const __internal = {
    deliver(evt: NativeEvent) {
        dispatchers.get(evt.id)?.(evt);
    },
    reset() {
        dispatchers.clear();
        nextId = 1;
        // Actually detach: dropping the flag without unsubscribing used to
        // leave a dead listener on the emitter for every reset.
        unsubscribe?.();
        unsubscribe = null;
    },
    get subscribed(): boolean {
        return unsubscribe !== null;
    },
    get dispatcherCount(): number {
        return dispatchers.size;
    },
};
