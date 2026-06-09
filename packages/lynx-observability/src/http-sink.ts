/**
 * Provider-agnostic batching HTTP sink — a {@link LogTransport} that buffers
 * log records and POSTs them as JSON to any endpoint (your own backend, an
 * OTLP-style collector, a serverless function, …). Register it with the core
 * logger's `addTransport`.
 *
 * Loop safety: the sink's own POST goes through `@sigx/lynx-http`, which logs
 * under the `http` namespace — so that namespace is excluded by default to
 * stop the sink from feeding its own traffic back into itself. The sink also
 * swallows its own send failures (it never logs them).
 */
import { fetch } from '@sigx/lynx-http';
import type { LogLevelName, LogRecord, LogTransport } from '@sigx/lynx-core';

const SEVERITY: Record<LogLevelName, number> = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 100,
};

export interface HttpSinkOptions {
    /** Endpoint that receives `POST` `{ records: WireRecord[] }`. */
    url: string;
    /** Extra headers (e.g. auth). `content-type: application/json` is set for you. */
    headers?: Record<string, string>;
    /** Flush once the buffer reaches this many records. Default 20. */
    batchSize?: number;
    /** Flush at most this often (ms) while records trickle in. Default 5000. */
    flushIntervalMs?: number;
    /** Keep this fraction (0–1) of non-error records; errors are always kept. Default 1. */
    sampleRate?: number;
    /** Only send records at or above this level. Default `'info'`. */
    minLevel?: LogLevelName;
    /** Namespaces to drop. Default `['http']` (prevents the sink's own POSTs feeding back). */
    excludeNamespaces?: string[];
}

interface WireRecord {
    level: LogLevelName;
    namespace: string;
    msg: string;
    fields: unknown[];
    ts: number;
}

/** A LogTransport with an extra `flush()` for tests / graceful shutdown. */
export type HttpSink = LogTransport & { flush(): void };

function serializeField(f: unknown): unknown {
    if (f instanceof Error) return { name: f.name, message: f.message, stack: f.stack };
    return f;
}

export function createHttpSink(opts: HttpSinkOptions): HttpSink {
    const batchSize = opts.batchSize ?? 20;
    const flushIntervalMs = opts.flushIntervalMs ?? 5000;
    const sampleRate = opts.sampleRate ?? 1;
    const minSeverity = SEVERITY[opts.minLevel ?? 'info'];
    const exclude = new Set(opts.excludeNamespaces ?? ['http']);

    let buffer: WireRecord[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (buffer.length === 0) return;
        const batch = buffer;
        buffer = [];
        // Fire-and-forget; swallow failures so the sink never feeds its own
        // errors back into the logger (which would loop into this transport).
        void fetch(opts.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...opts.headers },
            body: JSON.stringify({ records: batch }),
        }).catch(() => { /* dropped */ });
    };

    const schedule = (): void => {
        if (timer === null) timer = setTimeout(flush, flushIntervalMs);
    };

    const sink = ((record: LogRecord): void => {
        if (record.level.severity < minSeverity) return;
        if (exclude.has(record.namespace)) return;
        // Sample non-error records; always keep errors.
        if (sampleRate < 1 && record.level.severity < SEVERITY.error && Math.random() >= sampleRate) {
            return;
        }
        buffer.push({
            level: record.level.name,
            namespace: record.namespace,
            msg: record.msg,
            fields: record.fields.map(serializeField),
            ts: record.ts,
        });
        if (buffer.length >= batchSize) flush();
        else schedule();
    }) as HttpSink;

    sink.flush = flush;
    return sink;
}
