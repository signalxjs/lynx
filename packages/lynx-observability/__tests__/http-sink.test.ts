/**
 * HTTP sink tests with a mocked `@sigx/lynx-http` fetch: batching, on-demand
 * flush, level/namespace filtering, and Error-field serialization.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
vi.mock('@sigx/lynx-http', () => ({ fetch: (...a: unknown[]) => fetchMock(...(a as [])) }));

const { createHttpSink } = await import('../src/http-sink.js');
type Rec = import('@sigx/lynx-core').LogRecord;

function rec(
    name: Rec['level']['name'],
    severity: number,
    namespace = 'app',
    msg = 'm',
    fields: unknown[] = [],
): Rec {
    return { level: { name, severity }, namespace, msg, fields, ts: 1 };
}

beforeEach(() => fetchMock.mockClear());

describe('createHttpSink', () => {
    it('batches and flushes at batchSize, POSTing JSON records', () => {
        const sink = createHttpSink({ url: 'https://x/ingest', batchSize: 2 });
        sink(rec('info', 30));
        expect(fetchMock).not.toHaveBeenCalled();
        sink(rec('info', 30));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string; headers: Record<string, string> }];
        expect(url).toBe('https://x/ingest');
        expect(init.method).toBe('POST');
        expect(init.headers['content-type']).toBe('application/json');
        expect(JSON.parse(init.body).records).toHaveLength(2);
    });

    it('drops records below minLevel and from excluded namespaces (http by default)', () => {
        const sink = createHttpSink({ url: 'u', batchSize: 1, minLevel: 'warn' });
        sink(rec('info', 30));            // below warn
        sink(rec('warn', 40, 'http'));    // excluded namespace
        expect(fetchMock).not.toHaveBeenCalled();
        sink(rec('warn', 40, 'app'));     // passes
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('serializes Error fields to { name, message, stack }', () => {
        const sink = createHttpSink({ url: 'u', batchSize: 1, minLevel: 'error' });
        sink(rec('error', 50, 'uncaught', '[lynx] boom', [new Error('boom')]));
        const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
        expect(body.records[0].fields[0]).toMatchObject({ name: 'Error', message: 'boom' });
        expect(typeof body.records[0].fields[0].stack).toBe('string');
    });

    it('flush() sends a partial batch on demand', () => {
        const sink = createHttpSink({ url: 'u', batchSize: 10 });
        sink(rec('info', 30));
        expect(fetchMock).not.toHaveBeenCalled();
        sink.flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('always keeps errors even when sampleRate is 0', () => {
        const sink = createHttpSink({ url: 'u', batchSize: 1, sampleRate: 0, minLevel: 'trace' });
        sink(rec('info', 30));   // sampled out
        expect(fetchMock).not.toHaveBeenCalled();
        sink(rec('error', 50));  // errors bypass sampling
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
