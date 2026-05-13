/**
 * Browser-standard `WebSocket` client backed by the `@sigx/lynx-websocket`
 * native module (URLSessionWebSocketTask on iOS, OkHttp WebSocket on
 * Android).
 *
 * Public surface mirrors the WHATWG WebSocket interface:
 *
 *   new WebSocket(url, protocols?)
 *   .readyState / .url / .protocol / .extensions / .bufferedAmount
 *   .binaryType        ('arraybuffer' only — 'blob' is not supported)
 *   .onopen / .onmessage / .onerror / .onclose
 *   .addEventListener / .removeEventListener / .dispatchEvent
 *   .send(string | ArrayBuffer | ArrayBufferView)
 *   .close(code?, reason?)
 *
 * Multi-socket dispatch: each instance is assigned a monotonic numeric id.
 * The native side emits a single `__sigxWebSocketEvent` global event
 * carrying `{ id, type, ... }`; the JS shim demultiplexes by id and fires
 * the matching instance's listeners.
 */
import { callAsync, guardModule, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'WebSocket';
const EVENT_NAME = '__sigxWebSocketEvent';

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
interface NativeEvent {
    id: number;
    type: 'open' | 'message' | 'error' | 'close';
    /** Text body for message events, error message for error events. */
    data?: string;
    /** Base64-encoded binary payload (set when isBinary === true). */
    binary?: string;
    isBinary?: boolean;
    /** Negotiated subprotocol — populated on the open event. */
    protocol?: string;
    /** Negotiated extensions — populated on the open event. */
    extensions?: string;
    /** Close frame fields. */
    code?: number;
    reason?: string;
    wasClean?: boolean;
}

const CONNECTING = 0 as const;
const OPEN = 1 as const;
const CLOSING = 2 as const;
const CLOSED = 3 as const;

type ReadyState = 0 | 1 | 2 | 3;
type BinaryType = 'arraybuffer';

type EventListenerLike = ((ev: WebSocketEventLike) => void) | { handleEvent(ev: WebSocketEventLike): void };

/** Minimal WHATWG `Event` shape — enough for portable WS code. */
interface WebSocketEventLike {
    type: string;
    target: WebSocket;
    currentTarget: WebSocket;
    data?: unknown;
    code?: number;
    reason?: string;
    wasClean?: boolean;
    message?: string;
}

/**
 * Decode a base64 string into an `ArrayBuffer`. Lynx's BTS runtime has
 * `atob` per the platform docs, but fall back to a manual decoder to keep
 * this shim portable across hosts where it might be absent.
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const buf = new ArrayBuffer(bin.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
        return buf;
    }
    // Pure-JS fallback. Not the fastest, but executed at most for binary
    // frames on hosts that ship no atob (vanishingly rare).
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Int8Array(256).fill(-1);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const clean = b64.replace(/=+$/, '');
    const out = new Uint8Array((clean.length * 3) >> 2);
    let p = 0;
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const v = lookup[clean.charCodeAt(i)];
        if (v < 0) continue;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[p++] = (buf >> bits) & 0xff;
        }
    }
    return out.buffer;
}

/**
 * Encode an `ArrayBuffer` / view to base64 for transport to native.
 * Native side base64-decodes back to raw bytes before sending on the wire.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    if (typeof btoa === 'function') {
        // Build the binary string in chunks to dodge call-stack limits on
        // large frames (String.fromCharCode.apply blows up around ~64k args).
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
        }
        return btoa(bin);
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
    }
    if (i < bytes.length) {
        const rem = bytes.length - i;
        const n = rem === 1 ? bytes[i] << 16 : (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
        out += rem === 2 ? chars[(n >> 6) & 63] + '=' : '==';
    }
    return out;
}

// ---------------------------------------------------------------------------
// Shared event dispatch — one global lynx listener that demuxes by socket id.

const sockets = new Map<number, WebSocket>();
let nextId = 1;
let subscribed = false;
let cachedEmitter: GlobalEventEmitterLike | null = null;

function ensureSubscribed(): void {
    if (subscribed) return;
    const emitter = lynxObj()?.getJSModule?.('GlobalEventEmitter');
    if (!emitter) return; // web/SSR/test — events simply won't arrive
    cachedEmitter = emitter;
    emitter.addListener(EVENT_NAME, (raw: unknown) => {
        // Lynx ships event params as a single JSON-shaped object or as the
        // first arg of the listener. Tolerate both shapes.
        const evt: NativeEvent | undefined =
            typeof raw === 'string' ? safeParse(raw) : (raw as NativeEvent | undefined);
        if (!evt || typeof evt.id !== 'number') return;
        const ws = sockets.get(evt.id);
        if (!ws) return;
        // Internal dispatch lives on the instance so it can mutate state.
        (ws as unknown as { _dispatch(e: NativeEvent): void })._dispatch(evt);
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

// ---------------------------------------------------------------------------

/**
 * WHATWG-compatible WebSocket. Drop-in for browser code.
 *
 * @example
 * ```ts
 * const ws = new WebSocket('wss://ws.postman-echo.com/raw');
 * ws.onopen = () => ws.send('hello');
 * ws.onmessage = e => console.log(e.data);
 * ```
 */
export class WebSocket {
    static readonly CONNECTING = CONNECTING;
    static readonly OPEN = OPEN;
    static readonly CLOSING = CLOSING;
    static readonly CLOSED = CLOSED;

    readonly CONNECTING = CONNECTING;
    readonly OPEN = OPEN;
    readonly CLOSING = CLOSING;
    readonly CLOSED = CLOSED;

    readonly url: string;
    protocol = '';
    extensions = '';
    bufferedAmount = 0;
    binaryType: BinaryType = 'arraybuffer';

    onopen: ((ev: WebSocketEventLike) => void) | null = null;
    onmessage: ((ev: WebSocketEventLike) => void) | null = null;
    onerror: ((ev: WebSocketEventLike) => void) | null = null;
    onclose: ((ev: WebSocketEventLike) => void) | null = null;

    private _readyState: ReadyState = CONNECTING;
    private readonly _id: number;
    private readonly _listeners: Record<string, Set<EventListenerLike>> = Object.create(null);

    get readyState(): ReadyState {
        return this._readyState;
    }

    constructor(url: string, protocols?: string | string[]) {
        if (typeof url !== 'string' || url.length === 0) {
            throw new TypeError(`WebSocket: invalid URL`);
        }
        // Match browsers: only ws:/wss: are valid. We accept http:/https: too
        // and let the native side reject — some debug proxies normalise.
        const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
        if (scheme !== 'ws' && scheme !== 'wss' && scheme !== 'http' && scheme !== 'https') {
            throw new SyntaxError(`WebSocket: unsupported URL scheme "${scheme}"`);
        }

        guardModule(MODULE);

        this.url = url;
        this._id = nextId++;
        sockets.set(this._id, this);
        ensureSubscribed();

        const protoList = Array.isArray(protocols)
            ? protocols
            : typeof protocols === 'string' && protocols.length > 0
                ? [protocols]
                : [];

        // Fire-and-forget — open/error are delivered through the event
        // channel, not the callback. We still surface synchronous bridge
        // failures (e.g. module not registered) as an async error event.
        callAsync<void>(MODULE, 'create', this._id, url, protoList).catch(err => {
            this._dispatch({
                id: this._id,
                type: 'error',
                data: err instanceof Error ? err.message : String(err),
            });
            this._dispatch({
                id: this._id,
                type: 'close',
                code: 1006,
                reason: '',
                wasClean: false,
            });
        });
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this._readyState === CONNECTING) {
            // Browsers throw InvalidStateError here.
            throw new Error("InvalidStateError: WebSocket is still in CONNECTING state.");
        }
        if (this._readyState !== OPEN) {
            // Browsers silently drop on CLOSING/CLOSED but warn in devtools.
            return;
        }

        let isBinary = false;
        let payload: string;
        if (typeof data === 'string') {
            payload = data;
        } else if (data instanceof ArrayBuffer) {
            isBinary = true;
            payload = arrayBufferToBase64(data);
        } else if (ArrayBuffer.isView(data)) {
            isBinary = true;
            const view = data as ArrayBufferView;
            // Copy the active range out of the underlying buffer so we don't
            // accidentally send bytes outside the view.
            const slice = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
            payload = arrayBufferToBase64(slice);
        } else {
            throw new TypeError('WebSocket.send: unsupported data type');
        }

        // bufferedAmount is approximated as the byte length the JS side has
        // handed off — the native side acks via 'flushed' frames in a future
        // version; for now this is a write-through counter.
        this.bufferedAmount += isBinary ? base64ByteLength(payload) : utf8ByteLength(payload);

        callAsync<void>(MODULE, 'send', this._id, payload, isBinary).catch(err => {
            this._dispatch({
                id: this._id,
                type: 'error',
                data: err instanceof Error ? err.message : String(err),
            });
        });
    }

    close(code?: number, reason?: string): void {
        if (this._readyState === CLOSING || this._readyState === CLOSED) return;

        // WHATWG: code must be 1000 or 3000–4999. Validate to mirror browsers.
        if (code !== undefined) {
            if (code !== 1000 && (code < 3000 || code > 4999)) {
                throw new Error(
                    `InvalidAccessError: close code ${code} must be 1000 or in the 3000-4999 range.`,
                );
            }
        }
        if (reason !== undefined && utf8ByteLength(reason) > 123) {
            throw new SyntaxError('SyntaxError: close reason must be ≤123 UTF-8 bytes.');
        }

        this._readyState = CLOSING;
        callAsync<void>(MODULE, 'close', this._id, code ?? 1000, reason ?? '').catch(() => {
            // Swallow — we'll still receive a `close` event from native, or
            // a synthetic abnormal close if the bridge call itself fails.
        });
    }

    // -- EventTarget ---------------------------------------------------------

    addEventListener(type: string, listener: EventListenerLike): void {
        if (!listener) return;
        (this._listeners[type] ??= new Set()).add(listener);
    }

    removeEventListener(type: string, listener: EventListenerLike): void {
        this._listeners[type]?.delete(listener);
    }

    dispatchEvent(event: WebSocketEventLike): boolean {
        this._invoke(event.type, event);
        return true;
    }

    // -- Internal ------------------------------------------------------------

    /** @internal — called by the shared global-event subscriber. */
    private _dispatch(evt: NativeEvent): void {
        switch (evt.type) {
            case 'open': {
                this._readyState = OPEN;
                if (typeof evt.protocol === 'string') this.protocol = evt.protocol;
                if (typeof evt.extensions === 'string') this.extensions = evt.extensions;
                this._invoke('open', {
                    type: 'open',
                    target: this,
                    currentTarget: this,
                });
                break;
            }
            case 'message': {
                if (this._readyState !== OPEN) return;
                let data: string | ArrayBuffer;
                if (evt.isBinary && typeof evt.binary === 'string') {
                    data = base64ToArrayBuffer(evt.binary);
                } else {
                    data = evt.data ?? '';
                }
                this._invoke('message', {
                    type: 'message',
                    target: this,
                    currentTarget: this,
                    data,
                });
                break;
            }
            case 'error': {
                this._invoke('error', {
                    type: 'error',
                    target: this,
                    currentTarget: this,
                    message: evt.data,
                });
                break;
            }
            case 'close': {
                if (this._readyState === CLOSED) return;
                this._readyState = CLOSED;
                sockets.delete(this._id);
                this._invoke('close', {
                    type: 'close',
                    target: this,
                    currentTarget: this,
                    code: evt.code ?? 1006,
                    reason: evt.reason ?? '',
                    wasClean: evt.wasClean ?? false,
                });
                break;
            }
        }
    }

    private _invoke(type: string, event: WebSocketEventLike): void {
        const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
        if (typeof handler === 'function') {
            try {
                (handler as (e: WebSocketEventLike) => void).call(this, event);
            } catch (e) {
                console.warn(`[WebSocket] on${type} handler threw:`, e);
            }
        }
        const set = this._listeners[type];
        if (set) {
            for (const listener of set) {
                try {
                    if (typeof listener === 'function') listener.call(this, event);
                    else listener.handleEvent(event);
                } catch (e) {
                    console.warn(`[WebSocket] '${type}' listener threw:`, e);
                }
            }
        }
    }
}

/** Whether the native WebSocket module is registered in this build. */
export function isWebSocketAvailable(): boolean {
    return isModuleAvailable(MODULE);
}

// ---------------------------------------------------------------------------
// Byte-length helpers (kept local to avoid pulling a dep).

function utf8ByteLength(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
            n += 4;
            i++; // surrogate pair
        } else n += 3;
    }
    return n;
}

function base64ByteLength(b64: string): number {
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return ((b64.length * 3) >> 2) - padding;
}

// Test-only escape hatch: exported under a stable name with a leading
// underscore so it's tree-shakeable but reachable from unit tests.
/** @internal */
export const __internal = {
    deliver(evt: NativeEvent) {
        const ws = sockets.get(evt.id);
        if (ws) (ws as unknown as { _dispatch(e: NativeEvent): void })._dispatch(evt);
    },
    reset() {
        sockets.clear();
        nextId = 1;
        subscribed = false;
        cachedEmitter = null;
    },
    get cachedEmitter(): GlobalEventEmitterLike | null {
        return cachedEmitter;
    },
};
