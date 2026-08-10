/**
 * WHATWG-shaped `fetch` backed by the `Http` native module (URLSession on
 * iOS, OkHttp on Android).
 *
 * Multi-request dispatch mirrors `@sigx/lynx-websocket`: each request gets
 * a monotonic numeric id; the native side emits a single `__sigxHttpEvent`
 * global event carrying `{ id, type, ... }`; the JS shim demultiplexes by
 * id. The fetch promise resolves on the `response` event — before the body
 * has finished arriving — so streaming consumers can start reading
 * `res.body` immediately.
 *
 * Failures reject with a `TypeError` carrying the `[@sigx/lynx-http]` message
 * prefix (C10) — not a `SigxError`. This package mirrors a web standard and
 * installs itself on `globalThis`, so portable code branches on the spec's
 * types (`e instanceof TypeError` for a network failure, `e.name ===
 * 'AbortError'` for an abort); `SigxError` extends `Error` and would break
 * both.
 */
import {
    callAsync,
    guardModule,
    isModuleAvailable,
    isNativeEventsAvailable,
    subscribeNative,
    base64ToArrayBuffer,
    arrayBufferToBase64,
} from '@sigx/lynx-core';
import { Headers, type HeadersInitLike } from './headers.js';
import { FormData, formDataToNativeBody } from './form-data.js';
import { BodyStream, Response } from './response.js';
import type { NativeBody, NativeHttpEvent, NativeRequestSpec } from './types.js';
import * as httplog from './httplog.js';

const MODULE = 'Http';
const EVENT_NAME = '__sigxHttpEvent';

/** Duck-typed `AbortSignal` — works with any spec-shaped implementation. */
export interface AbortSignalLike {
    readonly aborted: boolean;
    reason?: unknown;
    addEventListener?: (type: 'abort', fn: () => void, opts?: { once?: boolean }) => void;
}

export type BodyInitLike = string | ArrayBuffer | ArrayBufferView | FormData | null | undefined;

export interface RequestInitLike {
    method?: string;
    headers?: HeadersInitLike;
    body?: BodyInitLike;
    signal?: AbortSignalLike;
    /**
     * Non-standard: upload progress for multipart/binary bodies. Fired
     * from native `progress` events (`didSendBodyData` / a counting
     * RequestBody) — handy for chat attachment UIs.
     */
    onUploadProgress?: (loaded: number, total: number) => void;
}

interface PendingRequest {
    stream: BodyStream;
    url: string;
    resolve: (r: Response) => void;
    reject: (e: unknown) => void;
    responded: boolean;
    onUploadProgress?: (loaded: number, total: number) => void;
}

const requests = new Map<number, PendingRequest>();
let nextId = 1;
/** The live subscription's disposer — also the "already subscribed" latch. */
let unsubscribe: (() => void) | undefined;

/**
 * Payload guard for `__sigxHttpEvent`.
 *
 * Native delivers each event as a JSON string (see `types.ts` — a structured
 * map loses sibling scalars on Lynx 0.5.0's bridge, #342); older native sent
 * the map directly. Core's `subscribeNative` already normalises both shapes,
 * so all that is left here is the demux key: an event without a numeric `id`
 * belongs to no request and must be dropped rather than dispatched.
 */
function isHttpEvent(raw: unknown): raw is NativeHttpEvent {
    return typeof raw === 'object' && raw !== null
        && typeof (raw as NativeHttpEvent).id === 'number';
}

/**
 * Attach the single demultiplexing listener, once.
 *
 * Lazy latch (C7): the first `fetch` can run before the Lynx runtime has
 * injected its `GlobalEventEmitter`, and off-device (web/SSR/test) there is
 * never one. `subscribeNative` is a silent no-op in that case and returns a
 * no-op disposer indistinguishable from a real one — so the latch is keyed on
 * `isNativeEventsAvailable()` instead, leaving a later request free to retry.
 */
function ensureSubscribed(): void {
    if (unsubscribe) return;
    if (!isNativeEventsAvailable()) return; // web/SSR/test — events simply won't arrive
    unsubscribe = subscribeNative<NativeHttpEvent>(
        EVENT_NAME,
        (evt) => {
            const pending = requests.get(evt.id);
            if (!pending) return;
            dispatch(evt.id, pending, evt);
        },
        { validate: isHttpEvent, namespace: 'lynx-http' },
    );
}

function dispatch(id: number, pending: PendingRequest, evt: NativeHttpEvent): void {
    switch (evt.type) {
        case 'response': {
            pending.responded = true;
            httplog.response(id, evt.status ?? 0);
            pending.resolve(new Response({
                status: evt.status ?? 0,
                statusText: evt.statusText ?? '',
                headers: new Headers(evt.headers ?? {}),
                url: pending.url,
                body: pending.stream,
            }));
            break;
        }
        case 'progress': {
            pending.onUploadProgress?.(evt.loaded ?? 0, evt.total ?? -1);
            break;
        }
        case 'chunk': {
            if (typeof evt.data === 'string' && evt.data.length > 0) {
                const u8 = new Uint8Array(base64ToArrayBuffer(evt.data));
                pending.stream.push(u8);
                httplog.addBytes(id, u8.byteLength);
            }
            break;
        }
        case 'done': {
            pending.stream.end();
            httplog.finish(id);
            requests.delete(id);
            break;
        }
        case 'error': {
            const err = new TypeError(`[@sigx/lynx-http] fetch failed: ${evt.message ?? 'network error'}`);
            httplog.fail(id, evt.message ?? 'network error');
            if (!pending.responded) pending.reject(err);
            else pending.stream.fail(err);
            requests.delete(id);
            break;
        }
    }
}

function abortError(reason?: unknown): Error {
    const err = reason instanceof Error
        ? reason
        : new Error(typeof reason === 'string' ? reason : 'The operation was aborted');
    err.name = 'AbortError';
    return err;
}

/** Build the native body descriptor + any implied headers. */
function normalizeBody(body: BodyInitLike, headers: Headers): NativeBody {
    if (body === undefined || body === null) {
        return { type: 'none' };
    }
    if (typeof body === 'string') {
        if (!headers.has('content-type')) {
            headers.set('content-type', 'text/plain;charset=UTF-8');
        }
        return { type: 'text', text: body };
    }
    if (body instanceof FormData) {
        const native = formDataToNativeBody(body);
        // The boundary in the header MUST match the descriptor's — replace
        // any caller-supplied multipart content-type.
        headers.set('content-type', `multipart/form-data; boundary=${native.boundary}`);
        return native;
    }
    if (body instanceof ArrayBuffer) {
        return { type: 'base64', data: arrayBufferToBase64(body) };
    }
    if (ArrayBuffer.isView(body)) {
        const copy = new Uint8Array(body.byteLength);
        copy.set(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
        return { type: 'base64', data: arrayBufferToBase64(copy.buffer) };
    }
    throw new TypeError(
        '[@sigx/lynx-http] fetch failed: unsupported body type — use string, ArrayBuffer, typed array, or FormData',
    );
}

export function fetch(input: string | { url: string }, init: RequestInitLike = {}): Promise<Response> {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || url.length === 0) {
        return Promise.reject(new TypeError('[@sigx/lynx-http] fetch failed: invalid URL'));
    }
    // The native transports only speak HTTP(S) — fail fast on anything
    // else (OkHttp throws on unknown schemes; URLSession may never emit a
    // response event, leaving the promise pending forever).
    const colon = url.indexOf(':');
    const scheme = colon > 0 ? url.slice(0, colon).toLowerCase() : '';
    if (scheme !== 'http' && scheme !== 'https') {
        return Promise.reject(
            new TypeError(`[@sigx/lynx-http] fetch failed: unsupported URL scheme "${scheme || url}"`),
        );
    }

    if (init.signal?.aborted) {
        return Promise.reject(abortError(init.signal.reason));
    }

    try {
        guardModule(MODULE);
    } catch (e) {
        return Promise.reject(e);
    }

    const headers = new Headers(init.headers);
    let body: NativeBody;
    try {
        body = normalizeBody(init.body, headers);
    } catch (e) {
        return Promise.reject(e);
    }

    const method = (init.method ?? (body.type === 'none' ? 'GET' : 'POST')).toUpperCase();
    if ((method === 'GET' || method === 'HEAD') && body.type !== 'none') {
        // Spec behavior — and the platforms disagree otherwise (OkHttp
        // throws on GET-with-body, URLSession may send it). Fail fast.
        return Promise.reject(
            new TypeError(`[@sigx/lynx-http] fetch failed: ${method} request cannot have a body`),
        );
    }
    const spec: NativeRequestSpec = {
        url,
        method,
        headers: headers.toRecord(),
        // Always request incremental delivery — small responses arrive in
        // one network read (= one chunk) anyway, and SSE/large bodies
        // stream without a non-standard opt-in. JS queues chunks either way.
        streaming: true,
        body,
    };

    const id = nextId++;
    const stream = new BodyStream();

    return new Promise<Response>((resolve, reject) => {
        const pending: PendingRequest = {
            stream,
            url,
            resolve,
            reject,
            responded: false,
            onUploadProgress: init.onUploadProgress,
        };
        requests.set(id, pending);
        httplog.start(id, method, url);
        ensureSubscribed();

        stream.onCancel = () => {
            requests.delete(id);
            httplog.abort(id, 'reader.cancel');
            void callAsync<void>(MODULE, 'abort', id).catch((e) => httplog.abortFailed(id, e));
        };

        init.signal?.addEventListener?.('abort', () => {
            if (!requests.has(id) && pending.responded) return;
            requests.delete(id);
            httplog.abort(id, 'signal');
            const err = abortError(init.signal?.reason);
            if (!pending.responded) reject(err);
            stream.fail(err);
            void callAsync<void>(MODULE, 'abort', id).catch((e) => httplog.abortFailed(id, e));
        }, { once: true });

        // Fire-and-forget — the response/error arrives through the event
        // channel. Synchronous bridge failures surface here.
        callAsync<unknown>(MODULE, 'request', id, spec).then((ack) => {
            const error = (ack as { error?: string } | null | undefined)?.error;
            if (error) {
                requests.delete(id);
                httplog.fail(id, error);
                const err = new TypeError(`[@sigx/lynx-http] fetch failed: ${error}`);
                if (!pending.responded) reject(err);
                else stream.fail(err);
            }
        }).catch((e) => {
            requests.delete(id);
            // Always a scoped `TypeError`, whatever the bridge threw. The most
            // common arrival here is core's `[@sigx/lynx-core] Module "Http" is
            // not available` — descriptive, but a bare `Error` under another
            // package's scope, so forwarding it as-is broke `fetch`'s documented
            // contract that every rejection is a `TypeError` reading
            // `[@sigx/lynx-http] fetch failed: …`. The original text is kept in
            // the message and the original error on `cause` (assigned rather
            // than passed to the constructor: this package targets ES2020,
            // which predates `Error.cause`).
            const detail = e instanceof Error ? e.message : String(e);
            const err = new TypeError(`[@sigx/lynx-http] fetch failed: ${detail}`);
            (err as TypeError & { cause?: unknown }).cause = e;
            httplog.fail(id, err.message);
            if (!pending.responded) reject(err);
            else stream.fail(err);
        });
    });
}

export function isHttpAvailable(): boolean {
    return isModuleAvailable(MODULE);
}

/**
 * Test-only hook: drop all pending requests and detach the native listener, so
 * each case starts from a clean module state. Calling it repeatedly is safe —
 * the disposer is idempotent (C7).
 */
export const __internal = {
    /**
     * The payload guard handed to `subscribeNative`.
     *
     * Exposed because the guard is *defence in depth*: dispatch below is
     * already total for a malformed event (`requests.get` misses, the switch
     * has no matching case), so no black-box test can tell whether the guard
     * is wired — deleting it leaves the behavioural tests green. Pinning it
     * directly is the only way this stays honest.
     */
    isHttpEvent,
    reset(): void {
        requests.clear();
        unsubscribe?.();
        unsubscribe = undefined;
    },
    /**
     * The live subscription's disposer (`undefined` before the first request,
     * and off-device). Exposed so tests can call it twice and prove double
     * disposal is a no-op — the bug shape that silently killed a still-wanted
     * subscription in `@sigx/lynx-audio`.
     */
    disposer(): (() => void) | undefined {
        return unsubscribe;
    },
};
