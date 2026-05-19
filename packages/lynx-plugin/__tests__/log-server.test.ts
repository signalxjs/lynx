/**
 * Tests for the lynx-plugin log-server middleware.
 *
 * Boots a real Node http.Server with the middleware installed as the only
 * handler, then drives it with raw HTTP requests so we exercise the same
 * code path rsbuild's connect server would.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
    createLogMiddleware,
    LOG_SENTINEL,
    LOG_ENDPOINT_PATH,
    type ServerLogEntry,
} from '../src/log-server';

let server: Server;
let baseUrl: string;
let lines: string[] = [];

beforeEach(async () => {
    lines = [];
    const middleware = createLogMiddleware((line) => { lines.push(line); });
    server = createServer((req, res) => {
        middleware(req, res, () => {
            res.statusCode = 404;
            res.end('not found');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no addr');
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: string, contentType = 'application/json'): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
    });
}

describe('createLogMiddleware', () => {
    it('passes non-matching requests to next()', async () => {
        const res = await fetch(`${baseUrl}/other`);
        expect(res.status).toBe(404);
        expect(lines).toEqual([]);
    });

    it('passes GET /__sigx/logs to next() (only POST handled)', async () => {
        const res = await fetch(`${baseUrl}${LOG_ENDPOINT_PATH}`);
        expect(res.status).toBe(404);
        expect(lines).toEqual([]);
    });

    it('emits a sentinel line per entry', async () => {
        const res = await post(LOG_ENDPOINT_PATH, JSON.stringify({
            entries: [
                { level: 'log', args: ['hello'], ts: 1, platform: 'ios' },
                { level: 'warn', args: ['oops'], ts: 2, platform: 'android' },
            ],
        }));
        expect(res.status).toBe(204);
        expect(lines).toHaveLength(2);
        for (const line of lines) {
            expect(line.startsWith(LOG_SENTINEL)).toBe(true);
            expect(line.endsWith('\n')).toBe(true);
        }
        const parsed = lines.map((l) => JSON.parse(l.slice(LOG_SENTINEL.length)) as ServerLogEntry);
        expect(parsed[0].level).toBe('log');
        expect(parsed[0].args).toEqual(['hello']);
        expect(parsed[0].platform).toBe('ios');
        expect(parsed[1].level).toBe('warn');
        // Same socket -> same client id.
        expect(parsed[0].client).toBe(parsed[1].client);
    });

    it('rejects invalid JSON with 400', async () => {
        const res = await post(LOG_ENDPOINT_PATH, '{not json');
        expect(res.status).toBe(400);
        expect(lines).toEqual([]);
    });

    it('rejects missing entries with 400', async () => {
        const res = await post(LOG_ENDPOINT_PATH, JSON.stringify({}));
        expect(res.status).toBe(400);
        expect(lines).toEqual([]);
    });

    it('skips invalid entries but accepts the rest', async () => {
        const res = await post(LOG_ENDPOINT_PATH, JSON.stringify({
            entries: [
                { level: 'bogus', args: ['x'], ts: 1, platform: 'ios' },
                { level: 'log', args: 'not-array', ts: 1, platform: 'ios' },
                { level: 'log', args: ['ok'], ts: 1, platform: 'ios' },
            ],
        }));
        expect(res.status).toBe(204);
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0].slice(LOG_SENTINEL.length)) as ServerLogEntry;
        expect(parsed.args).toEqual(['ok']);
    });

    it('coerces non-string args to strings', async () => {
        const res = await post(LOG_ENDPOINT_PATH, JSON.stringify({
            entries: [{ level: 'log', args: [1, true, null], ts: 1, platform: 'ios' }],
        }));
        expect(res.status).toBe(204);
        const parsed = JSON.parse(lines[0].slice(LOG_SENTINEL.length)) as ServerLogEntry;
        expect(parsed.args).toEqual(['1', 'true', 'null']);
    });

    it('rejects payloads larger than 1 MB with 413', async () => {
        const big = 'x'.repeat(1_000_100);
        const res = await post(
            LOG_ENDPOINT_PATH,
            JSON.stringify({ entries: [{ level: 'log', args: [big], ts: 1, platform: 'ios' }] }),
        );
        expect(res.status).toBe(413);
        expect(lines).toEqual([]);
    });
});
