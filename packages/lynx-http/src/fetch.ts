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
 */
import { callAsync, guardModule, isModuleAvailable, base64ToArrayBuffer, arrayBufferToBase64 } from '@sigx/lynx-core';
import { Headers, type HeadersInitLike } from './headers.js';
import { FormData, formDataToNativeBody } from './form-data.js';
import { BodyStream, Response } from './response.js';
import type { NativeBody, NativeHttpEvent, NativeRequestSpec } from './types.js';

const MODULE = 'Http';
const EVENT_NAME = '__sigxHttpEvent';

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
let subscribed = false;

function ensureSubscribed(): void {
    if (subscribed) return;
    const emitter = lynxObj()?.getJSModule?.('GlobalEventEmitter');
    if (!emitter) return; // web/SSR/test — events simply won't arrive
    emitter.addListener(EVENT_NAME, (raw: unknown) => {
        const evt: NativeHttpEvent | undefined =
            typeof raw === 'string' ? safeParse(raw) : (raw as NativeHttpEvent | undefined);
        if (!evt || typeof evt.id !== 'number') return;
        const pending = requests.get(evt.id);
        if (!pending) return;
        dispatch(evt.id, pending, evt);
    });
    subscribed = true;
}

function safeParse(s: string): NativeHttpEvent | undefined {
    try {
        return JSON.parse(s);
    } catch {
        return undefined;
    }
}

function dispatch(id: number, pending: PendingRequest, evt: NativeHttpEvent): void {
    switch (evt.type) {
        case 'response': {
            pending.responded = true;
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
                pending.stream.push(new Uint8Array(base64ToArrayBuffer(evt.data)));
            }
            break;
        }
        case 'done': {
            pending.stream.end();
            requests.delete(id);
            break;
        }
        case 'error': {
            const err = new TypeError(`fetch failed: ${evt.message ?? 'network error'}`);
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
    throw new TypeError('fetch: unsupported body type — use string, ArrayBuffer, typed array, or FormData');
}

export function fetch(input: string | { url: string }, init: RequestInitLike = {}): Promise<Response> {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || url.length === 0) {
        return Promise.reject(new TypeError('fetch: invalid URL'));
    }
    // The native transports only speak HTTP(S) — fail fast on anything
    // else (OkHttp throws on unknown schemes; URLSession may never emit a
    // response event, leaving the promise pending forever).
    const colon = url.indexOf(':');
    const scheme = colon > 0 ? url.slice(0, colon).toLowerCase() : '';
    if (scheme !== 'http' && scheme !== 'https') {
        return Promise.reject(new TypeError(`fetch: unsupported URL scheme "${scheme || url}"`));
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
        return Promise.reject(new TypeError(`fetch: ${method} request cannot have a body`));
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
        ensureSubscribed();

        stream.onCancel = () => {
            requests.delete(id);
            void callAsync<void>(MODULE, 'abort', id).catch(() => { /* already gone */ });
        };

        init.signal?.addEventListener?.('abort', () => {
            if (!requests.has(id) && pending.responded) return;
            requests.delete(id);
            const err = abortError(init.signal?.reason);
            if (!pending.responded) reject(err);
            stream.fail(err);
            void callAsync<void>(MODULE, 'abort', id).catch(() => { /* already gone */ });
        }, { once: true });

        // Fire-and-forget — the response/error arrives through the event
        // channel. Synchronous bridge failures surface here.
        callAsync<unknown>(MODULE, 'request', id, spec).then((ack) => {
            const error = (ack as { error?: string } | null | undefined)?.error;
            if (error) {
                requests.delete(id);
                const err = new TypeError(`fetch failed: ${error}`);
                if (!pending.responded) reject(err);
                else stream.fail(err);
            }
        }).catch((e) => {
            requests.delete(id);
            const err = e instanceof Error ? e : new TypeError(String(e));
            if (!pending.responded) reject(err);
            else stream.fail(err);
        });
    });
}

export function isHttpAvailable(): boolean {
    return isModuleAvailable(MODULE);
}

/** Test-only hook: drop all pending requests between cases. */
export const __internal = {
    reset(): void {
        requests.clear();
    },
};
