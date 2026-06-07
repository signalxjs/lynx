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

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
    base64ToArrayBuffer: (b64: string) => {
        const buf = Buffer.from(b64, 'base64');
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    arrayBufferToBase64: (buf: ArrayBuffer) => Buffer.from(buf).toString('base64'),
}));

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
        expect(bridge.callAsync.mock.calls.filter((c) => c[1] === 'request')).toHaveLength(0);
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
        await expect(p).rejects.toThrow(/connection refused/);
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
        await expect(fetch('https://x.test')).rejects.toThrow(/invalid request spec/);
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
