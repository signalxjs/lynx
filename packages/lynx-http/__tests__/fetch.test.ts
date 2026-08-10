/**
 * Unit tests for the `fetch` shim. Mocks `@sigx/lynx-core` so we drive the
 * bridge entirely in-process and fire synthetic `__sigxHttpEvent` payloads
 * through a fake GlobalEventEmitter — same harness as the websocket tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

// Only the bridge is faked. `subscribeNative` / `isNativeEventsAvailable` come
// from the REAL core (spread from importActual): the subscription contract —
// idempotent disposer, string-or-object payload, listener-throws isolation — is
// exactly what this suite has to exercise, and a hand-written stand-in would
// only test itself.
// `subscribeNative` is wrapped, not replaced: it still runs for real, but the
// wrapper records the options it was handed. That is the only way to pin the
// `validate` guard — dispatch below is total for a malformed event, so deleting
// the guard changes no observable behaviour.
const subscribeNativeCalls: unknown[][] = [];

vi.mock('@sigx/lynx-core', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@sigx/lynx-core');
    return {
    ...actual,
    subscribeNative: (...args: unknown[]) => {
        subscribeNativeCalls.push(args);
        return (actual.subscribeNative as (...a: unknown[]) => () => void)(...args);
    },
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
    base64ToArrayBuffer: (b64: string) => {
        const buf = Buffer.from(b64, 'base64');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    arrayBufferToBase64: (buf: ArrayBuffer) => Buffer.from(buf).toString('base64'),
    // httplog.ts uses the core logger; stub it so this suite stays focused on
    // request behavior (logger formatting is covered in httplog.test.ts).
    createLogger: () => ({
        trace() {}, debug() {}, info() {}, warn() {}, error() {},
        enabled: () => false,
    }),
    };
});

type Listener = (...a: unknown[]) => void;
const emitter = {
    listeners: new Map<string, Set<Listener>>(),
    addListener(name: string, fn: Listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name)!.add(fn);
    },
    removeListener(name: string, fn: Listener) {
        this.listeners.get(name)?.delete(fn);
    },
    /** How many handlers are registered — proves subscribe/unsubscribe counts. */
    count(name: string) {
        return this.listeners.get(name)?.size ?? 0;
    },
    /**
     * Dispatches like the native emitter does: one synchronous loop, no
     * per-listener try/catch. A handler that throws therefore starves every
     * handler after it — which is why C7's wrapper catches.
     */
    fire(name: string, ...args: unknown[]) {
        for (const fn of this.listeners.get(name) ?? []) fn(...args);
    },
};

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: (name: string) =>
        name === 'GlobalEventEmitter' ? emitter : undefined,
};

const { fetch, __internal } = await import('../src/fetch.js');
const { FormData } = await import('../src/form-data.js');

const EVENT = '__sigxHttpEvent';

/** The id the shim assigned to the most recent request() call. */
function lastRequestId(): number {
    const calls = bridge.callAsync.mock.calls.filter((c) => c[1] === 'request');
    return calls[calls.length - 1][2] as number;
}

function lastRequestSpec(): Record<string, unknown> {
    const calls = bridge.callAsync.mock.calls.filter((c) => c[1] === 'request');
    return calls[calls.length - 1][3] as Record<string, unknown>;
}

function fire(evt: Record<string, unknown>): void {
    emitter.fire(EVENT, evt);
}

/** Native delivery shape since #342: one JSON-string param per event. */
function fireJson(evt: Record<string, unknown>): void {
    emitter.fire(EVENT, JSON.stringify(evt));
}

function b64(s: string): string {
    return Buffer.from(s, 'utf-8').toString('base64');
}

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.guardModule.mockReset();
    __internal.reset();
});

describe('fetch — request spec', () => {
    it('defaults to GET with no body and flattened headers', async () => {
        const p = fetch('https://api.example.com/items', {
            headers: { Authorization: 'Bearer tok' },
        });
        const id = lastRequestId();
        expect(lastRequestSpec()).toEqual({
            url: 'https://api.example.com/items',
            method: 'GET',
            headers: { authorization: 'Bearer tok' },
            streaming: true,
            body: { type: 'none' },
        });
        fire({ id, type: 'response', status: 204, statusText: 'No Content', headers: {} });
        fire({ id, type: 'done' });
        await expect(p).resolves.toMatchObject({ status: 204 });
    });

    it('string body defaults Content-Type and method POST', async () => {
        const p = fetch('https://x.test', { body: '{"a":1}' });
        const spec = lastRequestSpec();
        expect(spec.method).toBe('POST');
        expect(spec.body).toEqual({ type: 'text', text: '{"a":1}' });
        expect((spec.headers as Record<string, string>)['content-type']).toBe('text/plain;charset=UTF-8');
        fire({ id: lastRequestId(), type: 'response', status: 200, statusText: 'OK', headers: {} });
        await p;
    });

    it('FormData body becomes a multipart descriptor with a matching boundary header', async () => {
        const form = new FormData();
        form.append('purpose', 'chat');
        form.append('file', { uri: 'file:///picked/a.pdf', name: 'a.pdf', mimeType: 'application/pdf' });
        const p = fetch('https://x.test/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer tok', 'Content-Type': 'multipart/form-data; boundary=WRONG' },
            body: form,
        });
        const spec = lastRequestSpec();
        const body = spec.body as { type: string; boundary: string; parts: unknown[] };
        expect(body.type).toBe('multipart');
        expect(body.parts).toHaveLength(2);
        // The caller's boundary is replaced by the generated one.
        expect((spec.headers as Record<string, string>)['content-type'])
            .toBe(`multipart/form-data; boundary=${body.boundary}`);
        expect((spec.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
        fire({ id: lastRequestId(), type: 'response', status: 201, statusText: 'Created', headers: {} });
        await p;
    });

    it('ArrayBuffer body crosses as base64', async () => {
        const bytes = Uint8Array.from([1, 2, 3, 255]);
        const p = fetch('https://x.test', { method: 'PUT', body: bytes.buffer });
        const spec = lastRequestSpec();
        expect(spec.body).toEqual({ type: 'base64', data: Buffer.from(bytes).toString('base64') });
        fire({ id: lastRequestId(), type: 'response', status: 200, statusText: 'OK', headers: {} });
        await p;
    });

    it('rejects GET/HEAD with a body (spec behavior; platforms disagree otherwise)', async () => {
        await expect(fetch('https://x.test', { method: 'GET', body: 'nope' })).rejects.toThrow(/GET request cannot have a body/);
        await expect(fetch('https://x.test', { method: 'head', body: 'nope' })).rejects.toThrow(/HEAD request cannot have a body/);
        expect(bridge.callAsync.mock.calls.filter((c) => c[1] === 'request')).toHaveLength(0);
    });

    it('rejects invalid URLs and unsupported bodies without hitting the bridge', async () => {
        await expect(fetch('')).rejects.toThrow(TypeError);
        await expect(fetch('https://x.test', { body: 42 as unknown as string })).rejects.toThrow(/unsupported body/);
        // C10: rejections stay TypeErrors (spec) but carry the package prefix.
        await expect(fetch('')).rejects.toThrow('[@sigx/lynx-http] fetch failed: invalid URL');
        await expect(fetch('https://x.test', { body: 42 as unknown as string }))
            .rejects.toThrow(/^\[@sigx\/lynx-http\] fetch failed: unsupported body type/);
        expect(bridge.callAsync.mock.calls.filter((c) => c[1] === 'request')).toHaveLength(0);
    });

    it('scopes a bridge rejection instead of forwarding it raw (C10)', async () => {
        // The realistic arrival here is core's own error when the native module
        // isn't linked: a bare `Error`, already descriptive, but under another
        // package's scope. `fetch` documents that every rejection is a
        // `TypeError` reading `[@sigx/lynx-http] fetch failed: …`, so it has to
        // be re-wrapped — while keeping core's text, which names what's missing.
        const bridgeError = new Error('[@sigx/lynx-core] Module "Http" is not available.');
        bridge.callAsync.mockRejectedValueOnce(bridgeError);

        const err = await fetch('https://x.test').catch((e: unknown) => e);

        expect(err).toBeInstanceOf(TypeError);
        expect((err as TypeError).message).toBe(
            '[@sigx/lynx-http] fetch failed: [@sigx/lynx-core] Module "Http" is not available.',
        );
        // The original survives on `cause`, so a caller can still inspect it.
        expect((err as TypeError & { cause?: unknown }).cause).toBe(bridgeError);
    });

    it('scopes a non-Error bridge rejection too', async () => {
        bridge.callAsync.mockRejectedValueOnce('boom');
        const err = await fetch('https://x.test').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(TypeError);
        expect((err as TypeError).message).toBe('[@sigx/lynx-http] fetch failed: boom');
    });

    it('rejects non-http(s) schemes up front (native would hang or throw)', async () => {
        await expect(fetch('ftp://files.example.com/a')).rejects.toThrow(/unsupported URL scheme/);
        await expect(fetch('ws://sock.example.com')).rejects.toThrow(/unsupported URL scheme/);
        await expect(fetch('not-a-url')).rejects.toThrow(/unsupported URL scheme/);
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });
});

describe('fetch — response lifecycle', () => {
    it('resolves on the response event; text() drains chunk+done', async () => {
        const p = fetch('https://x.test/data');
        const id = lastRequestId();
        fire({
            id,
            type: 'response',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json', 'x-req': 'r1' },
        });
        const res = await p;
        expect(res.ok).toBe(true);
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Req')).toBe('r1');
        fire({ id, type: 'chunk', data: b64('{"hello":"wörld"}') });
        fire({ id, type: 'done' });
        expect(await res.json()).toEqual({ hello: 'wörld' });
    });

    it('populates status/statusText/headers from a JSON-string event (native bridge form, #342)', async () => {
        // Native sends each event as a single JSON-string param (a structured
        // map drops `status`/`statusText`/`headers` on Lynx 0.5.0's bridge).
        // The shim must parse the string so `res.ok`/`res.status` are real.
        const p = fetch('https://x.test/login');
        const id = lastRequestId();
        fireJson({
            id,
            type: 'response',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json', 'x-trace': 't9' },
        });
        const res = await p;
        expect(res.status).toBe(200);
        expect(res.ok).toBe(true);
        expect(res.statusText).toBe('OK');
        expect(res.headers.get('X-Trace')).toBe('t9');
        fireJson({ id, type: 'chunk', data: b64('{"jwt":"abc"}') });
        fireJson({ id, type: 'done' });
        expect(await res.json()).toEqual({ jwt: 'abc' });
    });

    it('resolves BEFORE the body completes so the reader can stream', async () => {
        const p = fetch('https://x.test/sse');
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        const reader = res.body.getReader();

        const first = reader.read();
        fire({ id, type: 'chunk', data: b64('data: one\n\n') });
        expect(new TextDecoder().decode((await first).value)).toBe('data: one\n\n');

        fire({ id, type: 'chunk', data: b64('data: two\n\n') });
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: two\n\n');

        fire({ id, type: 'done' });
        expect((await reader.read()).done).toBe(true);
    });

    it('rejects the fetch promise on an error before the response', async () => {
        const p = fetch('https://x.test/down');
        fire({ id: lastRequestId(), type: 'error', message: 'connection refused' });
        await expect(p).rejects.toThrow('[@sigx/lynx-http] fetch failed: connection refused');
    });

    it('fails the body stream on an error after the response', async () => {
        const p = fetch('https://x.test/flaky');
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        fire({ id, type: 'chunk', data: b64('partial') });
        fire({ id, type: 'error', message: 'reset mid-body' });
        await expect(res.text()).rejects.toThrow(/reset mid-body/);
    });

    it('rejects when the request ack carries an error', async () => {
        bridge.callAsync.mockImplementationOnce(async () => ({ error: 'invalid request spec' }));
        await expect(fetch('https://x.test'))
            .rejects.toThrow('[@sigx/lynx-http] fetch failed: invalid request spec');
    });

    it('a second getReader() on the same body throws a prefixed TypeError', async () => {
        const p = fetch('https://x.test');
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        res.body.getReader();
        expect(() => res.body.getReader())
            .toThrow('[@sigx/lynx-http] BodyStream.getReader failed: already locked to a reader');
    });

    it('bodyUsed reflects reader-based consumption too (WHATWG disturbed)', async () => {
        const p = fetch('https://x.test');
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        expect(res.bodyUsed).toBe(false);
        res.body.getReader();
        expect(res.bodyUsed).toBe(true);
        await expect(res.text()).rejects.toThrow(/already consumed/);
    });

    it('enforces single body consumption', async () => {
        const p = fetch('https://x.test');
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        fire({ id, type: 'chunk', data: b64('once') });
        fire({ id, type: 'done' });
        expect(await res.text()).toBe('once');
        await expect(res.text()).rejects.toThrow(/already consumed/);
    });
});

describe('fetch — upload progress', () => {
    it('forwards progress events to onUploadProgress', async () => {
        const progress: Array<[number, number]> = [];
        const p = fetch('https://x.test/upload', {
            method: 'POST',
            body: 'payload',
            onUploadProgress: (loaded, total) => progress.push([loaded, total]),
        });
        const id = lastRequestId();
        fire({ id, type: 'progress', loaded: 10, total: 100 });
        fire({ id, type: 'progress', loaded: 100, total: 100 });
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        fire({ id, type: 'done' });
        await p;
        expect(progress).toEqual([[10, 100], [100, 100]]);
    });
});

describe('fetch — abort', () => {
    function makeSignal(): { signal: { aborted: boolean; reason?: unknown; addEventListener: (t: string, fn: () => void) => void }; abort: () => void } {
        const fns: Array<() => void> = [];
        const signal = {
            aborted: false,
            reason: undefined as unknown,
            addEventListener: (_t: string, fn: () => void) => fns.push(fn),
        };
        return {
            signal,
            abort: () => {
                signal.aborted = true;
                for (const fn of fns) fn();
            },
        };
    }

    it('rejects immediately for an already-aborted signal', async () => {
        const { signal, abort } = makeSignal();
        abort();
        await expect(fetch('https://x.test', { signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });

    it('abort mid-flight rejects the promise and calls Http.abort', async () => {
        const { signal, abort } = makeSignal();
        const p = fetch('https://x.test/slow', { signal });
        const id = lastRequestId();
        abort();
        await expect(p).rejects.toMatchObject({ name: 'AbortError' });
        expect(bridge.callAsync).toHaveBeenCalledWith('Http', 'abort', id);
    });

    it('a rejecting Http.abort is caught, not left unhandled', async () => {
        const { signal, abort } = makeSignal();
        const p = fetch('https://x.test/slow', { signal });
        const id = lastRequestId();
        // Next bridge call is the `abort` — make it fail (module gone, or the
        // request already finished natively). The caller must still see the
        // AbortError, and the rejection must not escape: an unhandled one is
        // fatal on the main thread (#863).
        bridge.callAsync.mockImplementationOnce(async () => { throw new Error('bridge gone'); });
        abort();
        await expect(p).rejects.toMatchObject({ name: 'AbortError' });
        expect(bridge.callAsync).toHaveBeenCalledWith('Http', 'abort', id);
    });

    it('abort after the response fails the body stream', async () => {
        const { signal, abort } = makeSignal();
        const p = fetch('https://x.test/sse', { signal });
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        abort();
        await expect(res.text()).rejects.toMatchObject({ name: 'AbortError' });
        expect(bridge.callAsync).toHaveBeenCalledWith('Http', 'abort', id);
    });

    it('reader.cancel() aborts the native request', async () => {
        const p = fetch('https://x.test/sse');
        const id = lastRequestId();
        fire({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        const reader = res.body.getReader();
        await reader.cancel();
        expect(bridge.callAsync).toHaveBeenCalledWith('Http', 'abort', id);
    });
});

/**
 * The native → JS subscription itself (convention C7). This package used to
 * carry its own `GlobalEventEmitterLike` shim — one of sixteen copies — and
 * inherited every gap in it. These lock the contract it now gets from core's
 * `subscribeNative`.
 */
describe('fetch — native event subscription (C7)', () => {
    /** A second handler on the same channel, standing in for another package's. */
    function bystander(): { seen: unknown[]; off: () => void } {
        const seen: unknown[] = [];
        const fn = (...a: unknown[]) => { seen.push(a[0]); };
        emitter.addListener(EVENT, fn);
        return { seen, off: () => emitter.removeListener(EVENT, fn) };
    }

    const okResponse = (id: number) =>
        ({ id, type: 'response', status: 200, statusText: 'OK', headers: {} });

    it('attaches exactly one listener however many requests are in flight', () => {
        expect(emitter.count(EVENT)).toBe(0); // beforeEach detached it
        void fetch('https://x.test/a');
        void fetch('https://x.test/b');
        void fetch('https://x.test/c');
        expect(emitter.count(EVENT)).toBe(1);
    });

    it('disposing twice leaves other listeners on the channel subscribed', async () => {
        // The lynx-audio regression in this package's terms: an idempotent
        // disposer is the difference between a second teardown being a no-op
        // and it tearing down something still in use.
        void fetch('https://x.test/a'); // orphaned below by the manual dispose
        const id = lastRequestId();
        const other = bystander();
        expect(emitter.count(EVENT)).toBe(2);

        const off = __internal.disposer()!;
        off();
        off(); // an effect cleanup firing twice is ordinary

        expect(emitter.count(EVENT)).toBe(1);
        fire(okResponse(id));
        expect(other.seen).toHaveLength(1);
        other.off();

        // …and the module re-attaches for the next request rather than going
        // permanently deaf.
        __internal.reset();
        const p2 = fetch('https://x.test/b');
        expect(emitter.count(EVENT)).toBe(1);
        fire(okResponse(lastRequestId()));
        await expect(p2).resolves.toMatchObject({ status: 200 });
    });

    it('a consumer callback that throws does not take the emitter down with it', async () => {
        // `onUploadProgress` is user code invoked synchronously from the native
        // dispatch. Before C7 an exception in it propagated straight out of the
        // emitter's dispatch loop: every listener registered after this
        // package's — including other packages' — was skipped for that event,
        // and on device the throw surfaces on the BG thread.
        //
        // Asserted through a capturing transport rather than a spy on the
        // logger: it proves the failure is *reported* (C10), not swallowed.
        const core = await import('@sigx/lynx-core');
        const records: string[] = [];
        core.clearTransports();
        core.setLogLevel('trace');
        core.addTransport((r) => records.push(`${r.namespace}|${r.msg}`));

        const p = fetch('https://x.test/upload', {
            method: 'POST',
            body: 'payload',
            onUploadProgress: () => { throw new Error('consumer blew up'); },
        });
        const id = lastRequestId();
        const other = bystander();

        expect(() => fire({ id, type: 'progress', loaded: 1, total: 2 })).not.toThrow();
        expect(other.seen).toHaveLength(1);
        // The record lands on this package's namespace — `subscribeNative`'s
        // `namespace` option builds the logger, so the diagnostic is filterable
        // as `lynx-http` rather than only readable as text.
        expect(records).toContain('lynx-http|listener for __sigxHttpEvent threw');

        // The request survives the bad callback and still completes.
        fire(okResponse(id));
        await expect(p).resolves.toMatchObject({ status: 200 });

        other.off();
        core.clearTransports();
        core.setLogLevel('warn');
    });

    it('wires the payload guard into the subscription, and the guard is right', async () => {
        // Two separate claims, because a black-box test can prove neither:
        // dispatch is total for a malformed event (`requests.get` simply
        // misses), so removing `validate` leaves every behavioural test green.
        const { isHttpEvent } = __internal;
        expect(isHttpEvent({ id: 1, type: 'done' })).toBe(true);
        expect(isHttpEvent({ id: '1', type: 'done' })).toBe(false);
        expect(isHttpEvent({ type: 'done' })).toBe(false);
        expect(isHttpEvent(null)).toBe(false);
        expect(isHttpEvent(42)).toBe(false);
        expect(isHttpEvent([])).toBe(false);

        // ...and that it is actually handed to `subscribeNative`.
        subscribeNativeCalls.length = 0;
        __internal.reset();
        void fetch('https://x.test/guard').catch(() => {});
        expect(subscribeNativeCalls).toHaveLength(1);
        expect(subscribeNativeCalls[0]![2]).toMatchObject({ validate: isHttpEvent });
    });

    it('keeps dispatch total when a malformed payload arrives', async () => {
        const p = fetch('https://x.test/a');
        const id = lastRequestId();

        // No numeric id → belongs to no request; unparseable string, null and
        // primitives → not an event at all. None may throw out of the dispatch.
        expect(() => {
            fire({ type: 'done' });
            emitter.fire(EVENT, '{not json');
            emitter.fire(EVENT, null);
            emitter.fire(EVENT, 42);
            emitter.fire(EVENT, { id: '7', type: 'done' });
        }).not.toThrow();

        // The live request is untouched by any of it.
        fire(okResponse(id));
        await expect(p).resolves.toMatchObject({ status: 200 });
    });

    it('retries the subscription when the runtime emitter appears later', async () => {
        // The first fetch can beat the Lynx runtime's GlobalEventEmitter
        // injection; latching "subscribed" then would leave the app permanently
        // deaf to every response event.
        vi.stubGlobal('lynx', {}); // runtime present, emitter not yet
        void fetch('https://x.test/early');
        expect(emitter.count(EVENT)).toBe(0);

        vi.stubGlobal('lynx', {
            getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
        });
        const p = fetch('https://x.test/late');
        expect(emitter.count(EVENT)).toBe(1);
        fire(okResponse(lastRequestId()));
        await expect(p).resolves.toMatchObject({ status: 200 });

        vi.unstubAllGlobals();
    });
});
