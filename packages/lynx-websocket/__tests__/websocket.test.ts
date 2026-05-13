/**
 * Unit tests for the `WebSocket` shim. Mocks `@sigx/lynx-core` so we drive
 * the bridge entirely in-process; the real bridge is exercised manually in
 * the reference app smoke test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the calls into the bridge so each test can assert what was sent
// to native. The mock module instance is shared across the import graph,
// so updating these in tests reaches the shim.
const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
}));

// Pretend lynx + GlobalEventEmitter exist so the shim attaches its
// shared listener. The emitter is captured here so tests can fire
// synthetic native events.
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

// Dynamic import so the mocks above are applied first.
const { WebSocket, __internal } = await import('../src/websocket.js');

const EVENT = '__sigxWebSocketEvent';

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.guardModule.mockClear();
    bridge.isModuleAvailable.mockClear();
});

afterEach(() => {
    // Drop all sockets between tests so internal id counters don't bleed.
    // (We intentionally don't reset `nextId` — monotonicity is part of the
    // contract; the demux still works because each test creates fresh
    // instances and the emitter listener targets ids by value.)
    emitter.listeners.clear();
    __internal.reset();
});

function open(ws: InstanceType<typeof WebSocket>, opts: { protocol?: string; extensions?: string } = {}) {
    const id = (ws as unknown as { _id: number })._id;
    emitter.fire(EVENT, { id, type: 'open', protocol: opts.protocol ?? '', extensions: opts.extensions ?? '' });
}

function deliverMessage(ws: InstanceType<typeof WebSocket>, data: string) {
    const id = (ws as unknown as { _id: number })._id;
    emitter.fire(EVENT, { id, type: 'message', data, isBinary: false });
}

function deliverBinary(ws: InstanceType<typeof WebSocket>, b64: string) {
    const id = (ws as unknown as { _id: number })._id;
    emitter.fire(EVENT, { id, type: 'message', binary: b64, isBinary: true });
}

function deliverClose(ws: InstanceType<typeof WebSocket>, code: number, reason: string, wasClean: boolean) {
    const id = (ws as unknown as { _id: number })._id;
    emitter.fire(EVENT, { id, type: 'close', code, reason, wasClean });
}

describe('WebSocket — construction', () => {
    it('exposes WHATWG ready-state constants on class and instance', () => {
        expect(WebSocket.CONNECTING).toBe(0);
        expect(WebSocket.OPEN).toBe(1);
        expect(WebSocket.CLOSING).toBe(2);
        expect(WebSocket.CLOSED).toBe(3);

        const ws = new WebSocket('wss://example.com/socket');
        expect(ws.CONNECTING).toBe(0);
        expect(ws.OPEN).toBe(1);
        expect(ws.CLOSING).toBe(2);
        expect(ws.CLOSED).toBe(3);
    });

    it('starts in CONNECTING and records the url', () => {
        const ws = new WebSocket('wss://example.com/socket');
        expect(ws.readyState).toBe(WebSocket.CONNECTING);
        expect(ws.url).toBe('wss://example.com/socket');
        expect(ws.protocol).toBe('');
        expect(ws.binaryType).toBe('arraybuffer');
    });

    it('calls native create with id, url, and protocol list', () => {
        const ws = new WebSocket('wss://example.com', ['v2.chat', 'v1.chat']);
        const id = (ws as unknown as { _id: number })._id;
        expect(bridge.callAsync).toHaveBeenCalledWith(
            'WebSocket',
            'create',
            id,
            'wss://example.com',
            ['v2.chat', 'v1.chat'],
        );
    });

    it('rejects empty URL', () => {
        expect(() => new WebSocket('')).toThrow(TypeError);
    });

    it('rejects unsupported schemes', () => {
        expect(() => new WebSocket('ftp://example.com')).toThrow(SyntaxError);
    });

    it('rejects URL without a scheme', () => {
        expect(() => new WebSocket('example.com')).toThrow(SyntaxError);
    });

    it('rejects URL that starts with a colon', () => {
        expect(() => new WebSocket(':nonsense')).toThrow(SyntaxError);
    });

    it('accepts http(s):// schemes as a convenience', () => {
        expect(() => new WebSocket('https://example.com')).not.toThrow();
    });

    it('guards the native module is registered', () => {
        new WebSocket('wss://example.com');
        expect(bridge.guardModule).toHaveBeenCalledWith('WebSocket');
    });
});

describe('WebSocket — open event', () => {
    it('transitions to OPEN and fires onopen', () => {
        const ws = new WebSocket('wss://example.com');
        const onopen = vi.fn();
        ws.onopen = onopen;
        open(ws, { protocol: 'v2.chat' });
        expect(ws.readyState).toBe(WebSocket.OPEN);
        expect(ws.protocol).toBe('v2.chat');
        expect(onopen).toHaveBeenCalledTimes(1);
        expect(onopen.mock.calls[0]![0]!.type).toBe('open');
        expect(onopen.mock.calls[0]![0]!.target).toBe(ws);
    });

    it('fires addEventListener subscribers in addition to onopen', () => {
        const ws = new WebSocket('wss://example.com');
        const slot = vi.fn();
        const listener = vi.fn();
        ws.onopen = slot;
        ws.addEventListener('open', listener);
        open(ws);
        expect(slot).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
    });
});

describe('WebSocket — send', () => {
    it('throws when called in CONNECTING', () => {
        const ws = new WebSocket('wss://example.com');
        expect(() => ws.send('nope')).toThrow(/CONNECTING/);
    });

    it('silently drops sends after close', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        deliverClose(ws, 1000, 'bye', true);
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        expect(() => ws.send('drop')).not.toThrow();
    });

    it('encodes ArrayBuffer as base64 with isBinary=true', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        const buf = new Uint8Array([0x01, 0x02, 0x03]).buffer;
        ws.send(buf);
        const id = (ws as unknown as { _id: number })._id;
        // Last call should be the send (after create + (open is event-driven, no call)).
        const sendCall = bridge.callAsync.mock.calls.find(
            (c) => c[1] === 'send' && c[2] === id,
        );
        expect(sendCall).toBeDefined();
        expect(sendCall![4]).toBe(true);
        // 0x01 0x02 0x03 → "AQID"
        expect(sendCall![3]).toBe('AQID');
    });

    it('sends typed-array views as binary (respecting byteOffset/byteLength)', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        const raw = new Uint8Array([0xff, 0x01, 0x02, 0x03, 0xff]);
        const view = new Uint8Array(raw.buffer, 1, 3); // -> [0x01,0x02,0x03]
        ws.send(view);
        const id = (ws as unknown as { _id: number })._id;
        const sendCall = bridge.callAsync.mock.calls.find(
            (c) => c[1] === 'send' && c[2] === id,
        );
        expect(sendCall![3]).toBe('AQID');
        expect(sendCall![4]).toBe(true);
    });

    it('sends strings with isBinary=false', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        ws.send('hi');
        const id = (ws as unknown as { _id: number })._id;
        const sendCall = bridge.callAsync.mock.calls.find(
            (c) => c[1] === 'send' && c[2] === id,
        );
        expect(sendCall![3]).toBe('hi');
        expect(sendCall![4]).toBe(false);
    });
});

describe('WebSocket — message dispatch', () => {
    it('routes text frames to onmessage with data as string', () => {
        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        open(ws);
        deliverMessage(ws, 'pong');
        expect(onmessage).toHaveBeenCalledTimes(1);
        expect(onmessage.mock.calls[0]![0]!.data).toBe('pong');
    });

    it('decodes binary frames to ArrayBuffer', () => {
        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        open(ws);
        deliverBinary(ws, 'AQID'); // -> [0x01, 0x02, 0x03]
        const ev = onmessage.mock.calls[0]![0]!;
        expect(ev.data).toBeInstanceOf(ArrayBuffer);
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        expect(Array.from(bytes)).toEqual([0x01, 0x02, 0x03]);
    });

    it('demultiplexes events by socket id', () => {
        const a = new WebSocket('wss://example.com/a');
        const b = new WebSocket('wss://example.com/b');
        const onA = vi.fn();
        const onB = vi.fn();
        a.onmessage = onA;
        b.onmessage = onB;
        open(a);
        open(b);
        deliverMessage(a, 'for-a');
        deliverMessage(b, 'for-b');
        expect(onA).toHaveBeenCalledTimes(1);
        expect(onA.mock.calls[0]![0]!.data).toBe('for-a');
        expect(onB).toHaveBeenCalledTimes(1);
        expect(onB.mock.calls[0]![0]!.data).toBe('for-b');
    });

    it('drops messages received before open', () => {
        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        deliverMessage(ws, 'early');
        expect(onmessage).not.toHaveBeenCalled();
    });
});

describe('WebSocket — close', () => {
    it('validates close codes', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        expect(() => ws.close(999)).toThrow(/code/);
        expect(() => ws.close(5000)).toThrow(/code/);
        expect(() => ws.close(1000)).not.toThrow();
    });

    it('validates reason length (≤123 UTF-8 bytes)', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        const longReason = 'x'.repeat(124);
        expect(() => ws.close(1000, longReason)).toThrow(/reason/);
    });

    it('moves to CLOSING and ignores re-close', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        ws.close(1000, 'bye');
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        const before = bridge.callAsync.mock.calls.length;
        ws.close(1000, 'bye');
        expect(bridge.callAsync.mock.calls.length).toBe(before);
    });

    it('fires onclose with code/reason/wasClean', () => {
        const ws = new WebSocket('wss://example.com');
        const onclose = vi.fn();
        ws.onclose = onclose;
        open(ws);
        deliverClose(ws, 1000, 'normal', true);
        expect(ws.readyState).toBe(WebSocket.CLOSED);
        const ev = onclose.mock.calls[0]![0]!;
        expect(ev.code).toBe(1000);
        expect(ev.reason).toBe('normal');
        expect(ev.wasClean).toBe(true);
    });

    it('fires close only once even with repeated close events', () => {
        const ws = new WebSocket('wss://example.com');
        const onclose = vi.fn();
        ws.onclose = onclose;
        open(ws);
        deliverClose(ws, 1000, '', true);
        deliverClose(ws, 1000, '', true);
        expect(onclose).toHaveBeenCalledTimes(1);
    });
});

describe('WebSocket — EventTarget', () => {
    it('supports multiple listeners and removeEventListener', () => {
        const ws = new WebSocket('wss://example.com');
        const a = vi.fn();
        const b = vi.fn();
        ws.addEventListener('message', a);
        ws.addEventListener('message', b);
        open(ws);
        deliverMessage(ws, 'hi');
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);

        ws.removeEventListener('message', a);
        deliverMessage(ws, 'again');
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(2);
    });

    it('isolates handler exceptions', () => {
        const ws = new WebSocket('wss://example.com');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        ws.onmessage = () => {
            throw new Error('boom');
        };
        const second = vi.fn();
        ws.addEventListener('message', second);
        open(ws);
        deliverMessage(ws, 'hi');
        expect(second).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('WebSocket — error path', () => {
    it('synthesizes an error+close when native create() rejects', async () => {
        bridge.callAsync.mockImplementationOnce(async () => {
            throw new Error('bridge down');
        });
        const ws = new WebSocket('wss://example.com');
        const onerror = vi.fn();
        const onclose = vi.fn();
        ws.onerror = onerror;
        ws.onclose = onclose;
        // Let the rejected promise's microtask run.
        await Promise.resolve();
        await Promise.resolve();
        expect(onerror).toHaveBeenCalled();
        expect(onclose).toHaveBeenCalledTimes(1);
        expect(onclose.mock.calls[0]![0]!.code).toBe(1006);
        expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('synthesizes an error+abnormal close when bridge close() rejects', async () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        const onerror = vi.fn();
        const onclose = vi.fn();
        ws.onerror = onerror;
        ws.onclose = onclose;
        bridge.callAsync.mockImplementationOnce(async () => {
            throw new Error('bridge gone');
        });
        ws.close(1000, 'bye');
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        await Promise.resolve();
        await Promise.resolve();
        expect(onerror).toHaveBeenCalled();
        expect(onclose).toHaveBeenCalledTimes(1);
        expect(onclose.mock.calls[0]![0]!.code).toBe(1006);
        expect(onclose.mock.calls[0]![0]!.wasClean).toBe(false);
        expect(ws.readyState).toBe(WebSocket.CLOSED);
    });
});
