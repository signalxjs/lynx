/**
 * Tests for the device-side console streamer.
 *
 * The streamer is exercised with a stub `WebSocket` plus controllable
 * `setTimeout` / `clearTimeout` / `now` implementations so we can drive the
 * connect / flush / reconnect loop synchronously and assert exact ordering
 * of messages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    installConsoleStreamer,
    serializeArg,
    type LogEntry,
    type MinimalWebSocket,
    type WebSocketCtor,
} from '../src/streamer';

// ---------------------------------------------------------------------------
// Test seam: a controllable scheduler that runs queued callbacks on demand.
// ---------------------------------------------------------------------------
interface FakeTimer {
    id: number;
    cb: () => void;
}

function createScheduler(): {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    runAll: () => void;
    pending: () => number;
} {
    let nextId = 1;
    const timers: FakeTimer[] = [];
    const setTimeoutStub = ((cb: () => void): number => {
        const id = nextId++;
        timers.push({ id, cb });
        return id;
    }) as unknown as typeof setTimeout;
    const clearTimeoutStub = ((id: number): void => {
        const idx = timers.findIndex((t) => t.id === id);
        if (idx !== -1) timers.splice(idx, 1);
    }) as unknown as typeof clearTimeout;
    return {
        setTimeout: setTimeoutStub,
        clearTimeout: clearTimeoutStub,
        runAll() {
            // Run in waves so handlers that schedule new timers also fire.
            while (timers.length > 0) {
                const next = timers.shift()!;
                next.cb();
            }
        },
        pending() {
            return timers.length;
        },
    };
}

// ---------------------------------------------------------------------------
// Fake WebSocket — records sends, fires open/close/error on demand.
// ---------------------------------------------------------------------------

interface FakeWS extends MinimalWebSocket {
    url: string;
    sent: string[];
    _open(): void;
    _close(reason?: string): void;
    _error(message?: string): void;
}

function createFakeWSFactory(): {
    ctor: WebSocketCtor;
    instances: FakeWS[];
    last(): FakeWS;
} {
    const instances: FakeWS[] = [];
    class FakeWebSocket implements FakeWS {
        readyState = 0; // CONNECTING
        sent: string[] = [];
        onopen: ((e: unknown) => void) | null = null;
        onmessage: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onclose: ((e: unknown) => void) | null = null;
        constructor(public url: string) {
            instances.push(this);
        }
        send(data: string): void {
            this.sent.push(data);
        }
        close(): void {
            if (this.readyState === 3) return;
            this.readyState = 3;
            this.onclose?.({ reason: 'closed by caller' });
        }
        _open(): void {
            this.readyState = 1;
            this.onopen?.({});
        }
        _close(reason = 'gone'): void {
            this.readyState = 3;
            this.onclose?.({ reason });
        }
        _error(message = 'boom'): void {
            this.onerror?.({ message });
        }
    }
    return {
        ctor: FakeWebSocket as unknown as WebSocketCtor,
        instances,
        last() {
            return instances[instances.length - 1];
        },
    };
}

// A small console stub so installs in tests don't leak into the real terminal.
interface CapturedConsole {
    console: Console;
    logs: { level: string; args: unknown[] }[];
}
function createConsole(): CapturedConsole {
    const logs: { level: string; args: unknown[] }[] = [];
    const make = (level: string) => (...args: unknown[]) => {
        logs.push({ level, args });
    };
    const c = {
        log: make('log'),
        info: make('info'),
        warn: make('warn'),
        error: make('error'),
        debug: make('debug'),
        trace: make('trace'),
    } as unknown as Console;
    return { console: c, logs };
}

// Save / restore globalThis.console around each test so installs don't bleed.
let originalConsole: Console;
beforeEach(() => {
    originalConsole = globalThis.console;
});
afterEach(() => {
    // Uninstall any leftover streamer.
    const c = globalThis.console as unknown as Record<string, unknown>;
    const u = c['__sigxLogStreamerUninstall__'];
    if (typeof u === 'function') (u as () => void)();
    globalThis.console = originalConsole;
});

// ---------------------------------------------------------------------------
// serializeArg
// ---------------------------------------------------------------------------

describe('serializeArg', () => {
    it('handles primitives', () => {
        expect(serializeArg(null)).toBe('null');
        expect(serializeArg(undefined)).toBe('undefined');
        expect(serializeArg('hi')).toBe('hi');
        expect(serializeArg(42)).toBe('42');
        expect(serializeArg(true)).toBe('true');
        expect(serializeArg(10n)).toBe('10n');
    });

    it('handles symbols and functions without throwing', () => {
        expect(serializeArg(Symbol('x'))).toBe('Symbol(x)');
        expect(serializeArg(function named() {})).toBe('[Function: named]');
        expect(serializeArg(() => 0)).toMatch(/\[Function/);
    });

    it('handles errors using their stack', () => {
        const err = new Error('boom');
        const out = serializeArg(err);
        expect(out).toContain('Error');
        expect(out).toContain('boom');
    });

    it('handles circular references', () => {
        const a: Record<string, unknown> = {};
        a['self'] = a;
        const out = serializeArg(a);
        expect(out).toContain('[Circular]');
    });

    it('serialises arrays', () => {
        expect(serializeArg([1, 'two', null])).toBe('[1, two, null]');
    });

    it('serialises plain objects as JSON', () => {
        expect(serializeArg({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
    });
});

// ---------------------------------------------------------------------------
// installConsoleStreamer
// ---------------------------------------------------------------------------

describe('installConsoleStreamer', () => {
    it('returns a no-op when url is empty', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        const uninstall = installConsoleStreamer('', {});
        expect(typeof uninstall).toBe('function');
        expect((c as unknown as Record<string, unknown>)['__sigxLogStreamerUninstall__']).toBeUndefined();
    });

    it('returns no-op when WebSocket is unavailable', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        // Force the resolver to find nothing.
        const prevWS = (globalThis as { WebSocket?: unknown }).WebSocket;
        delete (globalThis as { WebSocket?: unknown }).WebSocket;
        try {
            const uninstall = installConsoleStreamer('ws://x/__sigx/logs', {
                webSocketImpl: undefined,
            });
            expect((c as unknown as Record<string, unknown>)['__sigxLogStreamerUninstall__']).toBeUndefined();
            uninstall();
        } finally {
            if (prevWS !== undefined) (globalThis as { WebSocket?: unknown }).WebSocket = prevWS;
        }
    });

    it('patches console.* and forwards calls to the original', () => {
        const { console: c, logs } = createConsole();
        globalThis.console = c;

        const sched = createScheduler();
        const ws = createFakeWSFactory();
        installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
            platform: 'ios',
        });

        // eslint-disable-next-line no-console
        console.log('hello', 42);
        expect(logs).toEqual([{ level: 'log', args: ['hello', 42] }]);

        // One socket has been constructed (eagerly on first enqueue) but not
        // yet opened, so nothing has been sent.
        expect(ws.instances).toHaveLength(1);
        expect(ws.last().url).toBe('ws://x/__sigx/logs');
        expect(ws.last().sent).toHaveLength(0);
    });

    it('queues entries while CONNECTING and drains them on open', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();

        installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
            nowImpl: () => 1700000000000,
            platform: 'android',
        });

        // eslint-disable-next-line no-console
        console.warn('msg', { k: 'v' });
        // eslint-disable-next-line no-console
        console.log('two');

        expect(ws.last().sent).toHaveLength(0);
        ws.last()._open();

        expect(ws.last().sent).toHaveLength(1);
        const body = JSON.parse(ws.last().sent[0]) as { entries: LogEntry[] };
        expect(body.entries).toHaveLength(2);
        expect(body.entries[0].level).toBe('warn');
        expect(body.entries[0].platform).toBe('android');
        expect(body.entries[0].args).toEqual(['msg', '{"k":"v"}']);
        expect(body.entries[0].ts).toBe(1700000000000);
        expect(body.entries[1].level).toBe('log');
        expect(body.entries[1].args).toEqual(['two']);
    });

    it('coalesces non-error logs after open via flushIntervalMs', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();

        installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
        });
        ws.last()._open();

        // eslint-disable-next-line no-console
        console.log('a');
        // eslint-disable-next-line no-console
        console.log('b');
        // Nothing sent yet — waiting on the coalesce timer.
        expect(ws.last().sent).toHaveLength(0);
        sched.runAll();
        expect(ws.last().sent).toHaveLength(1);
        const body = JSON.parse(ws.last().sent[0]) as { entries: LogEntry[] };
        expect(body.entries).toHaveLength(2);
    });

    it('flushes immediately on error-level logs', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();

        installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
        });
        ws.last()._open();

        // eslint-disable-next-line no-console
        console.error('bad');
        expect(ws.last().sent).toHaveLength(1);
        const body = JSON.parse(ws.last().sent[0]) as { entries: LogEntry[] };
        expect(body.entries[0].level).toBe('error');
    });

    it('reconnects and re-queues batch when send throws', () => {
        const { console: c, logs } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();

        installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
            backoffInitialMs: 1,
        });

        // Open the first socket then make `.send` throw on the next call.
        ws.last()._open();
        const first = ws.last();
        first.send = function (this: FakeWS) {
            throw new Error('send broke');
        }.bind(first);

        // eslint-disable-next-line no-console
        console.error('boom'); // error → immediate pump → throws → reconnect
        // Original captured warn was used to log the failure.
        expect(logs.some((l) => l.level === 'warn' && String(l.args[0]).includes('WS closed'))).toBe(true);

        // A reconnect timer was scheduled.
        expect(sched.pending()).toBeGreaterThan(0);
        sched.runAll();

        // A second WS instance was created.
        expect(ws.instances).toHaveLength(2);
        ws.last()._open();

        // The re-queued batch is now delivered on the new socket.
        expect(ws.last().sent).toHaveLength(1);
        const body = JSON.parse(ws.last().sent[0]) as { entries: LogEntry[] };
        expect(body.entries[0].level).toBe('error');
        expect(body.entries[0].args).toEqual(['boom']);
    });

    it('caps the queue at maxQueueSize while disconnected', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();

        installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
            maxQueueSize: 3,
            flushBatchSize: 100,
        });

        // Never open the socket → everything queues.
        for (let i = 0; i < 10; i++) {
            // eslint-disable-next-line no-console
            console.log(`entry ${i}`);
        }
        ws.last()._open();
        expect(ws.last().sent).toHaveLength(1);
        const body = JSON.parse(ws.last().sent[0]) as { entries: LogEntry[] };
        // Only the most recent 3 should have survived the cap.
        expect(body.entries).toHaveLength(3);
        expect(body.entries.map((e) => e.args[0])).toEqual(['entry 7', 'entry 8', 'entry 9']);
    });

    it('restores original console.* on uninstall', () => {
        const { console: c, logs } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();
        const uninstall = installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
        });

        const patched = c.log;
        uninstall();
        expect(c.log).not.toBe(patched);
        c.log('after');
        expect(logs.some((l) => l.level === 'log' && l.args[0] === 'after')).toBe(true);
        expect((c as unknown as Record<string, unknown>)['__sigxLogStreamerUninstall__']).toBeUndefined();
    });

    it('is idempotent across double install', () => {
        const { console: c } = createConsole();
        globalThis.console = c;
        const sched = createScheduler();
        const ws = createFakeWSFactory();
        const u1 = installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
        });
        const u2 = installConsoleStreamer('ws://x/__sigx/logs', {
            webSocketImpl: ws.ctor,
            setTimeoutImpl: sched.setTimeout,
            clearTimeoutImpl: sched.clearTimeout,
        });
        expect(u1).toBe(u2);
    });
});
