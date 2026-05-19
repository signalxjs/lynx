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
    LOG_ENDPOINT_PATH,
    LOG_SENTINEL,
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
});
