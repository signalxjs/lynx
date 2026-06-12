/**
 * Shared event plumbing for the WebRTC module.
 *
 * Native pushes a single `__sigxWebRTCEvent` global event carrying
 * `{ id, type, ... }`; one listener registered on lynx's
 * `GlobalEventEmitter` demultiplexes by numeric id to the entity
 * (peer connection, data channel, or track) that owns it.
 *
 * Id scheme: JS-created entities (peers, local tracks, local data
 * channels) draw positive ids from `allocId()`. Native-created entities
 * (remote tracks, remote data channels) carry negative ids allocated by
 * the native side — globally unique with zero coordination, so the demux
 * stays a single map.
 */

const MODULE = 'WebRTC';
const EVENT_NAME = '__sigxWebRTCEvent';

export { MODULE, EVENT_NAME };

/** Bridge to lynx's `GlobalEventEmitter` for native → JS events. */
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
let subscribed = false;
let cachedEmitter: GlobalEventEmitterLike | null = null;

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

export function ensureSubscribed(): void {
    if (subscribed) return;
    const emitter = lynxObj()?.getJSModule?.('GlobalEventEmitter');
    if (!emitter) return; // web/SSR/test — events simply won't arrive
    cachedEmitter = emitter;
    emitter.addListener(EVENT_NAME, (raw: unknown) => {
        const evt: NativeEvent | undefined =
            typeof raw === 'string' ? safeParse(raw) : (raw as NativeEvent | undefined);
        if (!evt || typeof evt.id !== 'number') return;
        dispatchers.get(evt.id)?.(evt);
    });
    subscribed = true;
}

function safeParse(s: string): NativeEvent | undefined {
    try {
        return JSON.parse(s);
    } catch {
        return undefined;
    }
}

/**
 * Unwrap a native callback result: `{ error, errorName? }` rejects with an
 * Error whose `name` mirrors the DOMException name browsers throw (e.g.
 * `NotAllowedError` for a denied microphone prompt).
 */
export function unwrap<T>(result: unknown): T {
    const err = (result as { error?: unknown } | null)?.error;
    if (typeof err === 'string') {
        const e = new Error(err);
        const name = (result as { errorName?: unknown }).errorName;
        if (typeof name === 'string' && name.length > 0) e.name = name;
        throw e;
    }
    return result as T;
}

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
                console.warn(`[WebRTC] on${type} handler threw:`, e);
            }
        }
        const set = this._listeners[type];
        if (set) {
            for (const listener of set) {
                try {
                    if (typeof listener === 'function') listener.call(this, event);
                    else listener.handleEvent(event);
                } catch (e) {
                    console.warn(`[WebRTC] '${type}' listener threw:`, e);
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
        subscribed = false;
        cachedEmitter = null;
    },
    get cachedEmitter(): GlobalEventEmitterLike | null {
        return cachedEmitter;
    },
    get dispatcherCount(): number {
        return dispatchers.size;
    },
};
