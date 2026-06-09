/**
 * End-to-end streaming consumption: an SSE-style parser written against
 * the web platform (getReader + TextDecoder with { stream: true }) running
 * over the fetch shim, with native chunk events split at hostile byte
 * boundaries — mid-UTF-8-sequence and mid-`data:` line.
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
    createLogger: () => ({ trace() {}, debug() {}, info() {}, warn() {}, error() {}, enabled: () => false }),
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
const { SigxTextDecoder } = await import('../src/codec.js');

const EVENT = '__sigxHttpEvent';

function lastRequestId(): number {
    const calls = bridge.callAsync.mock.calls.filter((c) => c[1] === 'request');
    return calls[calls.length - 1][2] as number;
}

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    __internal.reset();
});

/** Minimal SSE line parser, shaped like real web SSE consumers. */
function makeSseParser() {
    const events: string[] = [];
    let buffer = '';
    return {
        events,
        push(text: string) {
            buffer += text;
            for (;;) {
                const nl = buffer.indexOf('\n');
                if (nl < 0) break;
                const line = buffer.slice(0, nl).replace(/\r$/, '');
                buffer = buffer.slice(nl + 1);
                if (line.startsWith('data: ')) events.push(line.slice(6));
            }
        },
    };
}

describe('streaming body — SSE consumption', () => {
    it('reassembles data: lines across hostile chunk boundaries', async () => {
        const p = fetch('https://x.test/sse', { headers: { Accept: 'text/event-stream' } });
        const id = lastRequestId();
        emitter.fire(EVENT, { id, type: 'response', status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });
        const res = await p;

        // The full SSE payload, then split at byte positions that bisect
        // both a `data:` line and the 4-byte 🌍 emoji.
        const payload = 'data: hej\n\ndata: vä🌍rld\n\ndata: klar\n\n';
        const bytes = new TextEncoder().encode(payload);
        const emojiStart = payload.indexOf('🌍');
        const emojiByteOffset = new TextEncoder().encode(payload.slice(0, emojiStart)).length;
        const cuts = [4, emojiByteOffset + 2]; // mid-line, mid-emoji
        const slices: Uint8Array[] = [];
        let prev = 0;
        for (const cut of [...cuts, bytes.length]) {
            slices.push(bytes.subarray(prev, cut));
            prev = cut;
        }

        const reader = res.body.getReader();
        const decoder = new SigxTextDecoder();
        const parser = makeSseParser();

        // Interleave: deliver a chunk, then read it — token-by-token.
        const seen: number[] = [];
        for (const slice of slices) {
            emitter.fire(EVENT, { id, type: 'chunk', data: Buffer.from(slice).toString('base64') });
            const { done, value } = await reader.read();
            expect(done).toBe(false);
            parser.push(decoder.decode(value, { stream: true }));
            seen.push(parser.events.length);
        }
        parser.push(decoder.decode());

        emitter.fire(EVENT, { id, type: 'done' });
        expect((await reader.read()).done).toBe(true);

        expect(parser.events).toEqual(['hej', 'vä🌍rld', 'klar']);
        // Incremental: events surfaced before the stream finished, not all
        // at the end — the first cut already yields nothing, the second
        // yields the first event, etc.
        expect(seen[seen.length - 2]).toBeGreaterThan(0);
    });

    it('streams a long body chunk-by-chunk without buffering everything', async () => {
        const p = fetch('https://x.test/big');
        const id = lastRequestId();
        emitter.fire(EVENT, { id, type: 'response', status: 200, statusText: 'OK', headers: {} });
        const res = await p;
        const reader = res.body.getReader();

        let received = 0;
        for (let i = 0; i < 20; i++) {
            const chunk = new Uint8Array(1024).fill(i);
            emitter.fire(EVENT, { id, type: 'chunk', data: Buffer.from(chunk).toString('base64') });
            const { value } = await reader.read();
            expect(value).toHaveLength(1024);
            expect(value![0]).toBe(i); // order preserved
            received += value!.byteLength;
        }
        emitter.fire(EVENT, { id, type: 'done' });
        expect((await reader.read()).done).toBe(true);
        expect(received).toBe(20 * 1024);
    });
});
