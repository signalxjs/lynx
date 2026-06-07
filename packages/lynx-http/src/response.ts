/**
 * WHATWG-shaped `Response` with a ReadableStream-like `.body`.
 *
 * The body is a chunk queue fed by native `chunk` events. With the
 * buffered native implementation (#249) it receives a single chunk then
 * `end()`; the streaming implementation (#250) feeds it incrementally.
 * Either way `getReader()` / `text()` / `json()` behave identically, so
 * SSE consumers written against the streaming build run unchanged on the
 * buffered one (they just see one big chunk).
 */
import { Headers } from './headers.js';
import { SigxTextDecoder } from './codec.js';

interface PendingRead {
    resolve: (r: { done: boolean; value?: Uint8Array }) => void;
    reject: (e: unknown) => void;
}

/**
 * Minimal ReadableStream-like backing `Response.body`. Exposes exactly
 * what byte consumers use: `getReader()` → `{ read, cancel, releaseLock }`.
 * Backpressure is not implemented — chunks queue in JS until read (same
 * tradeoff as `@sigx/lynx-websocket`).
 */
export class BodyStream {
    private chunks: Uint8Array[] = [];
    private ended = false;
    private error: unknown = null;
    private pending: PendingRead[] = [];
    private lockedFlag = false;
    /** Called when the consumer cancels mid-stream — aborts the request. */
    onCancel: ((reason?: unknown) => void) | null = null;

    get locked(): boolean {
        return this.lockedFlag;
    }

    /** Native side delivered body bytes. */
    push(chunk: Uint8Array): void {
        if (this.ended || this.error) return;
        const waiter = this.pending.shift();
        if (waiter) waiter.resolve({ done: false, value: chunk });
        else this.chunks.push(chunk);
    }

    /** Native side signalled `done`. */
    end(): void {
        if (this.ended || this.error) return;
        this.ended = true;
        for (const w of this.pending.splice(0)) w.resolve({ done: true });
    }

    /** Native side signalled `error` (or the request was aborted). */
    fail(err: unknown): void {
        if (this.ended || this.error) return;
        this.error = err;
        for (const w of this.pending.splice(0)) w.reject(err);
    }

    getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(reason?: unknown): Promise<void>;
        releaseLock(): void;
    } {
        if (this.lockedFlag) {
            throw new TypeError('BodyStream: already locked to a reader');
        }
        this.lockedFlag = true;
        return {
            read: () => {
                if (this.error) return Promise.reject(this.error);
                const queued = this.chunks.shift();
                if (queued) return Promise.resolve({ done: false, value: queued });
                if (this.ended) return Promise.resolve({ done: true });
                return new Promise((resolve, reject) => {
                    this.pending.push({ resolve, reject });
                });
            },
            cancel: (reason?: unknown) => {
                this.chunks = [];
                if (!this.ended && !this.error) {
                    this.onCancel?.(reason);
                    this.end();
                }
                return Promise.resolve();
            },
            releaseLock: () => {
                this.lockedFlag = false;
            },
        };
    }
}

export class Response {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly url: string;
    readonly body: BodyStream;
    private bodyUsed_ = false;

    constructor(init: { status: number; statusText: string; headers: Headers; url: string; body: BodyStream }) {
        this.status = init.status;
        this.statusText = init.statusText;
        this.headers = init.headers;
        this.url = init.url;
        this.body = init.body;
    }

    get ok(): boolean {
        return this.status >= 200 && this.status < 300;
    }

    get bodyUsed(): boolean {
        return this.bodyUsed_;
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        const parts = await this.drain();
        let total = 0;
        for (const p of parts) total += p.byteLength;
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
            out.set(p, off);
            off += p.byteLength;
        }
        return out.buffer;
    }

    async text(): Promise<string> {
        const parts = await this.drain();
        const decoder = new SigxTextDecoder();
        let out = '';
        for (const p of parts) out += decoder.decode(p, { stream: true });
        out += decoder.decode();
        return out;
    }

    async json(): Promise<unknown> {
        return JSON.parse(await this.text());
    }

    private async drain(): Promise<Uint8Array[]> {
        if (this.bodyUsed_) {
            throw new TypeError('Response: body already consumed');
        }
        this.bodyUsed_ = true;
        const reader = this.body.getReader();
        try {
            const parts: Uint8Array[] = [];
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) parts.push(value);
            }
            return parts;
        } finally {
            // WHATWG behavior: the lock clears once consumption finishes,
            // even when the read loop throws.
            reader.releaseLock();
        }
    }
}
