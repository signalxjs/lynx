/**
 * Tests for the lynx-plugin WebSocket log server.
 *
 * Boots a real `ws.Server` on an ephemeral port and drives it with a real
 * `ws` client, so we exercise the same code path the dev plugin would.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';

import {
    createLogWebSocketServer,
    detectPlatformFromUserAgent,
    LOG_ENDPOINT_PATH,
    LOG_SENTINEL,
    RELOAD_ENDPOINT_PATH,
    type LogWebSocketServer,
    type ServerLogEntry,
} from '../src/log-server';

let server: LogWebSocketServer;
let lines: string[] = [];

beforeEach(async () => {
    lines = [];
    server = await createLogWebSocketServer({
        port: 0,
        host: '127.0.0.1',
        writeLine: (line) => { lines.push(line); },
    });
});

afterEach(async () => {
    await server.close();
});

/** Open a client, send each batch, then close. Resolves once all sends have been ack'd. */
async function sendBatches(batches: unknown[], opts: { wait?: number } = {}): Promise<void> {
    const url = `ws://127.0.0.1:${server.port}${LOG_ENDPOINT_PATH}`;
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
    for (const batch of batches) {
        await new Promise<void>((resolve, reject) => {
            ws.send(typeof batch === 'string' ? batch : JSON.stringify(batch), (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }
    // Give the server's `message` handler a moment to drain before close.
    await new Promise((r) => setTimeout(r, opts.wait ?? 20));
    await new Promise<void>((resolve) => { ws.once('close', () => resolve()); ws.close(); });
}

describe('createLogWebSocketServer', () => {
    it('emits a sentinel line per entry', async () => {
        await sendBatches([{
            entries: [
                { level: 'log', args: ['hello'], ts: 1, platform: 'ios' },
                { level: 'warn', args: ['oops'], ts: 2, platform: 'android' },
            ],
        }]);

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
        // Same socket → same client id.
        expect(parsed[0].client).toBe(parsed[1].client);
    });

    it('drops invalid JSON silently', async () => {
        await sendBatches(['{not json']);
        expect(lines).toEqual([]);
    });

    it('drops missing entries array silently', async () => {
        await sendBatches([{ wrong: true }]);
        expect(lines).toEqual([]);
    });

    it('skips invalid entries but accepts the rest', async () => {
        await sendBatches([{
            entries: [
                { level: 'bogus', args: ['x'], ts: 1, platform: 'ios' },
                { level: 'log', args: 'not-array', ts: 1, platform: 'ios' },
                { level: 'log', args: ['ok'], ts: 1, platform: 'ios' },
            ],
        }]);
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0].slice(LOG_SENTINEL.length)) as ServerLogEntry;
        expect(parsed.args).toEqual(['ok']);
    });

    it('coerces non-string args to strings', async () => {
        await sendBatches([{
            entries: [{ level: 'log', args: [1, true, null], ts: 1, platform: 'ios' }],
        }]);
        const parsed = JSON.parse(lines[0].slice(LOG_SENTINEL.length)) as ServerLogEntry;
        expect(parsed.args).toEqual(['1', 'true', 'null']);
    });

    it('assigns distinct client ids to concurrent connections', async () => {
        const url = `ws://127.0.0.1:${server.port}${LOG_ENDPOINT_PATH}`;
        const make = async (): Promise<WebSocket> => {
            const w = new WebSocket(url);
            await new Promise<void>((r, j) => { w.once('open', r); w.once('error', j); });
            return w;
        };
        const a = await make();
        const b = await make();
        await new Promise<void>((r, j) => a.send(JSON.stringify({
            entries: [{ level: 'log', args: ['from-a'], ts: 1, platform: 'ios' }],
        }), (e) => e ? j(e) : r()));
        await new Promise<void>((r, j) => b.send(JSON.stringify({
            entries: [{ level: 'log', args: ['from-b'], ts: 1, platform: 'ios' }],
        }), (e) => e ? j(e) : r()));
        await new Promise((r) => setTimeout(r, 30));
        a.close(); b.close();

        expect(lines).toHaveLength(2);
        const byArg = (arg: string): ServerLogEntry =>
            JSON.parse(lines.find((l) => l.includes(arg))!.slice(LOG_SENTINEL.length));
        expect(byArg('from-a').client).not.toBe(byArg('from-b').client);
    });

    it('rejects oversized payloads (>1MB) by closing the connection', async () => {
        const big = 'x'.repeat(1_000_100);
        const url = `ws://127.0.0.1:${server.port}${LOG_ENDPOINT_PATH}`;
        const w = new WebSocket(url);
        await new Promise<void>((r, j) => { w.once('open', r); w.once('error', j); });
        // ws will tear down the connection when the server's maxPayload check
        // fires; either the send-callback errors or the socket closes — either
        // way no sentinel line should be emitted.
        try {
            w.send(JSON.stringify({
                entries: [{ level: 'log', args: [big], ts: 1, platform: 'ios' }],
            }));
        } catch { /* ignore — we just don't want a sentinel */ }
        await new Promise((r) => setTimeout(r, 50));
        try { w.terminate(); } catch { /* ignore */ }
        expect(lines).toEqual([]);
    });

    it('falls back to UA-sniffed platform when device reports unknown', async () => {
        // The `ws` Node client sends a default User-Agent header. We can't
        // override it with the ws-client API directly, so we drive the server
        // by emitting on the WS upgrade path with a hand-crafted UA via
        // the `headers` option.
        const url = `ws://127.0.0.1:${server.port}${LOG_ENDPOINT_PATH}`;
        const w = new WebSocket(url, { headers: { 'user-agent': 'okhttp/4.12.0' } });
        await new Promise<void>((r, j) => { w.once('open', r); w.once('error', j); });
        await new Promise<void>((r, j) => w.send(JSON.stringify({
            entries: [
                { level: 'log', args: ['hi'], ts: 1, platform: 'unknown' },
                { level: 'log', args: ['ios-wins'], ts: 1, platform: 'ios' },
            ],
        }), (e) => e ? j(e) : r()));
        await new Promise((r) => setTimeout(r, 30));
        w.close();

        const parsed = lines.map((l) => JSON.parse(l.slice(LOG_SENTINEL.length)) as ServerLogEntry);
        expect(parsed[0].platform).toBe('android'); // sniffed from okhttp UA
        expect(parsed[1].platform).toBe('ios');     // device-reported wins
    });
});

describe('reload broadcast', () => {
    async function openClient(): Promise<WebSocket> {
        const url = `ws://127.0.0.1:${server.port}${LOG_ENDPOINT_PATH}`;
        const w = new WebSocket(url);
        await new Promise<void>((res, rej) => { w.once('open', res); w.once('error', rej); });
        return w;
    }

    async function postReload(): Promise<{ status: number; body: string }> {
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const http = require('node:http') as typeof import('node:http');
            const req = http.request({
                hostname: '127.0.0.1',
                port: server.port,
                path: RELOAD_ENDPOINT_PATH,
                method: 'POST',
            }, (res) => {
                let body = '';
                res.setEncoding('utf-8');
                res.on('data', (c: string) => { body += c; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
            });
            req.on('error', reject);
            req.end();
        });
    }

    it('broadcastReload returns 0 when no clients are connected', () => {
        expect(server.broadcastReload()).toBe(0);
    });

    it('broadcastReload sends {type:"reload"} to every open client', async () => {
        const a = await openClient();
        const b = await openClient();
        const aMessages: string[] = [];
        const bMessages: string[] = [];
        a.on('message', (raw) => { aMessages.push(raw.toString('utf8')); });
        b.on('message', (raw) => { bMessages.push(raw.toString('utf8')); });

        const sent = server.broadcastReload();
        expect(sent).toBe(2);

        // Both sockets should receive the reload payload.
        await new Promise((r) => setTimeout(r, 30));
        for (const msgs of [aMessages, bMessages]) {
            expect(msgs).toHaveLength(1);
            expect(JSON.parse(msgs[0])).toEqual({ type: 'reload' });
        }

        a.close();
        b.close();
    });

    it('POST /__sigx/reload broadcasts and returns the client count', async () => {
        const a = await openClient();
        const received: string[] = [];
        a.on('message', (raw) => { received.push(raw.toString('utf8')); });

        const res = await postReload();
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ reloaded: 1 });

        await new Promise((r) => setTimeout(r, 30));
        expect(received).toHaveLength(1);
        expect(JSON.parse(received[0])).toEqual({ type: 'reload' });

        a.close();
    });

    it('POST /__sigx/reload returns reloaded:0 when no clients are connected', async () => {
        const res = await postReload();
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ reloaded: 0 });
    });

    it('drops the socket from the live set on close', async () => {
        const a = await openClient();
        // Wait for handshake to settle and confirm we see it.
        await new Promise((r) => setTimeout(r, 20));
        expect(server.broadcastReload()).toBeGreaterThan(0);

        // Close and wait for the server-side close handler to fire.
        await new Promise<void>((resolve) => { a.once('close', () => resolve()); a.close(); });
        await new Promise((r) => setTimeout(r, 30));

        expect(server.broadcastReload()).toBe(0);
    });
});

describe('hello on connect', () => {
    it('greets each connection with {type:"hello",buildId} when buildId is set', async () => {
        const s = await createLogWebSocketServer({
            port: 0,
            host: '127.0.0.1',
            buildId: 'build-123',
            writeLine: () => { /* ignore logs here */ },
        });
        try {
            const url = `ws://127.0.0.1:${s.port}${LOG_ENDPOINT_PATH}`;
            const w = new WebSocket(url);
            const messages: string[] = [];
            w.on('message', (raw) => { messages.push(raw.toString('utf8')); });
            await new Promise<void>((r, j) => { w.once('open', r); w.once('error', j); });
            await new Promise((r) => setTimeout(r, 30));
            expect(messages).toHaveLength(1);
            expect(JSON.parse(messages[0])).toEqual({ type: 'hello', buildId: 'build-123' });
            w.close();
        } finally {
            await s.close();
        }
    });

    it('does not send a hello when no buildId is configured', async () => {
        // The default `server` (beforeEach) is created without a buildId.
        const url = `ws://127.0.0.1:${server.port}${LOG_ENDPOINT_PATH}`;
        const w = new WebSocket(url);
        const messages: string[] = [];
        w.on('message', (raw) => { messages.push(raw.toString('utf8')); });
        await new Promise<void>((r, j) => { w.once('open', r); w.once('error', j); });
        await new Promise((r) => setTimeout(r, 30));
        expect(messages).toEqual([]);
        w.close();
    });
});

describe('detectPlatformFromUserAgent', () => {
    it('detects android from okhttp', () => {
        expect(detectPlatformFromUserAgent('okhttp/4.12.0')).toBe('android');
    });
    it('detects ios from CFNetwork', () => {
        expect(detectPlatformFromUserAgent('My-App/1.0 CFNetwork/1485 Darwin/23.1.0')).toBe('ios');
    });
    it('detects ios from Darwin', () => {
        expect(detectPlatformFromUserAgent('Darwin/22.0.0')).toBe('ios');
    });
    it('falls back to unknown', () => {
        expect(detectPlatformFromUserAgent('Mozilla/5.0')).toBe('unknown');
        expect(detectPlatformFromUserAgent(undefined)).toBe('unknown');
        expect(detectPlatformFromUserAgent('')).toBe('unknown');
    });
});
