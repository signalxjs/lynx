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

const logWarn = vi.fn();

/**
 * Shape-compatible stand-in for core's `SigxError` — the mock replaces the
 * whole barrel, so the shim's `throw new SigxError(...)` needs a class here
 * for tests to assert `.code` on.
 */
class MockSigxError extends Error {
    readonly code: string;
    readonly package: string;
    constructor(pkg: string, code: string, message: string) {
        super(message);
        this.name = 'SigxError';
        this.code = code;
        this.package = pkg;
    }
}

const subscribeNativeCalls: unknown[][] = [];

vi.mock('@sigx/lynx-core', async () => {
const realEvents = await import('../../lynx-core/src/events.js');
return {
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
    isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
    SigxError: MockSigxError,
    // Only the native bridge is faked. `subscribeNative` /
    // `isNativeEventsAvailable` are the REAL C7 implementations (imported from
    // source to skip the barrel), so the payload guard, the listener-isolation
    // and the disposer semantics under test are the shipped ones.
    // Wrapped, not replaced: the real implementation still runs, but the
    // wrapper records the options. That is the only way to pin the `validate`
    // guard — every malformed payload is absorbed downstream anyway (a
    // `sockets.get` miss, an unmatched `switch`), so deleting the guard leaves
    // the behavioural test below green.
    subscribeNative: (...a: unknown[]) => {
        subscribeNativeCalls.push(a);
        return (realEvents.subscribeNative as unknown as (...x: unknown[]) => () => void)(...a);
    },
    isNativeEventsAvailable: realEvents.isNativeEventsAvailable,
    createLogger: () => ({
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: logWarn,
        error: vi.fn(),
        enabled: () => true,
    }),
};
});

// Pretend lynx + GlobalEventEmitter exist so the shim attaches its
// shared listener. The emitter is captured here so tests can fire
// synthetic native events.
//
// `addCalls` / `removeCalls` count what actually reached the emitter: a Set
// swallows a duplicate `removeListener`, so counting is the only way to see
// whether a disposer is genuinely idempotent rather than merely harmless
// against this fake.
type Listener = (...a: unknown[]) => void;
const emitter = {
    listeners: new Map<string, Set<Listener>>(),
    addCalls: 0,
    removeCalls: 0,
    addListener(name: string, fn: Listener) {
        this.addCalls++;
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name)!.add(fn);
    },
    removeListener(name: string, fn: Listener) {
        this.removeCalls++;
        this.listeners.get(name)?.delete(fn);
    },
    fire(name: string, ...args: unknown[]) {
        // Deliberately unguarded, exactly like the native emitter's dispatch
        // loop: a listener that throws here stops every listener after it.
        for (const fn of this.listeners.get(name) ?? []) fn(...args);
    },
    count(name: string) {
        return this.listeners.get(name)?.size ?? 0;
    },
};

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: (name: string) =>
        name === 'GlobalEventEmitter' ? emitter : undefined,
};

// Dynamic import so the mocks above are applied first.
const { WebSocket, __internal } = await import('../src/websocket.js');
const { subscribeNative } = await import('../../lynx-core/src/events.js');

const EVENT = '__sigxWebSocketEvent';

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.guardModule.mockClear();
    bridge.isModuleAvailable.mockClear();
    logWarn.mockClear();
    emitter.addCalls = 0;
    emitter.removeCalls = 0;
});

afterEach(() => {
    // Drop all sockets between tests so internal id counters don't bleed.
    // (We intentionally don't reset `nextId` — monotonicity is part of the
    // contract; the demux still works because each test creates fresh
    // instances and the emitter listener targets ids by value.)
    //
    // `reset()` is the *only* teardown: it has to detach the shared listener
    // by itself. Clearing `emitter.listeners` here as well would hide a leaked
    // registration behind the fixture — which is how the leak below survived.
    __internal.reset();
    expect(emitter.count(EVENT)).toBe(0);
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

    it('isolates handler exceptions and reports them through the core logger', () => {
        const ws = new WebSocket('wss://example.com');
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        ws.onmessage = () => {
            throw new Error('boom');
        };
        const second = vi.fn();
        ws.addEventListener('message', second);
        open(ws);
        deliverMessage(ws, 'hi');
        expect(second).toHaveBeenCalledTimes(1);
        // C10: diagnostics reach the leveled logger (and so the `sigx dev`
        // terminal), never `console.warn` directly.
        expect(logWarn).toHaveBeenCalledWith('onmessage handler threw', expect.any(Error));
        expect(consoleWarn).not.toHaveBeenCalled();
        consoleWarn.mockRestore();
    });

    it('reports a throwing addEventListener subscriber through the logger', () => {
        const ws = new WebSocket('wss://example.com');
        ws.addEventListener('message', () => {
            throw new Error('boom');
        });
        open(ws);
        deliverMessage(ws, 'hi');
        expect(logWarn).toHaveBeenCalledWith("'message' listener threw", expect.any(Error));
    });
});

describe('WebSocket — errors (C10)', () => {
    it('prefixes every constructor rejection with the package scope', () => {
        expect(() => new WebSocket('')).toThrow(
            '[@sigx/lynx-websocket] new WebSocket() failed: invalid URL',
        );
        expect(() => new WebSocket('example.com')).toThrow(
            '[@sigx/lynx-websocket] new WebSocket() failed: invalid URL "example.com"',
        );
        expect(() => new WebSocket('ftp://example.com')).toThrow(
            '[@sigx/lynx-websocket] new WebSocket() failed: unsupported URL scheme "ftp"',
        );
    });

    it('throws a coded InvalidStateError when send() is called in CONNECTING', () => {
        const ws = new WebSocket('wss://example.com');
        try {
            ws.send('nope');
            expect.unreachable('send() should throw in CONNECTING');
        } catch (e) {
            const err = e as MockSigxError;
            // The DOMException name is the discriminant browser code uses, so
            // it lands on both `name` (WHATWG) and `code` (C10).
            expect(err.name).toBe('InvalidStateError');
            expect(err.code).toBe('InvalidStateError');
            expect(err.package).toBe('lynx-websocket');
            expect(err.message).toBe(
                '[@sigx/lynx-websocket] send failed: the socket is still in the CONNECTING state.',
            );
        }
    });

    it('throws a coded InvalidAccessError for an out-of-range close code', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        try {
            ws.close(999);
            expect.unreachable('close(999) should throw');
        } catch (e) {
            const err = e as MockSigxError;
            expect(err.name).toBe('InvalidAccessError');
            expect(err.code).toBe('InvalidAccessError');
            expect(err.message).toBe(
                '[@sigx/lynx-websocket] close failed: close code 999 must be 1000 or in the 3000-4999 range.',
            );
        }
    });

    it('keeps the standard error classes portable code catches', () => {
        const ws = new WebSocket('wss://example.com');
        open(ws);
        // TypeError for a bad argument type, SyntaxError for a malformed one —
        // what a browser throws, so `instanceof` checks in portable code hold.
        expect(() => ws.send(42 as unknown as string)).toThrow(TypeError);
        expect(() => ws.send(42 as unknown as string)).toThrow(
            '[@sigx/lynx-websocket] send failed: unsupported data type',
        );
        expect(() => ws.close(1000, 'x'.repeat(124))).toThrow(SyntaxError);
        expect(() => ws.close(1000, 'x'.repeat(124))).toThrow(
            '[@sigx/lynx-websocket] close failed: close reason must be ≤123 UTF-8 bytes.',
        );
    });

    it('logs a bridge failure in addition to firing the error event', async () => {
        bridge.callAsync.mockImplementationOnce(async () => {
            throw new Error('bridge down');
        });
        const ws = new WebSocket('wss://example.com');
        const id = (ws as unknown as { _id: number })._id;
        await Promise.resolve();
        await Promise.resolve();
        expect(logWarn).toHaveBeenCalledWith(`create(${id}) failed`, expect.any(Error));
    });
});

describe('native subscription (C7)', () => {
    it('attaches exactly one shared listener however many sockets are created', () => {
        new WebSocket('wss://example.com/a');
        new WebSocket('wss://example.com/b');
        new WebSocket('wss://example.com/c');
        expect(emitter.addCalls).toBe(1);
        expect(emitter.count(EVENT)).toBe(1);
    });

    it('detaches on teardown instead of leaving the listener behind', () => {
        new WebSocket('wss://example.com');
        expect(emitter.count(EVENT)).toBe(1);

        __internal.reset();

        // The bug this replaces: teardown dropped a `subscribed` flag without
        // ever calling `removeListener`, so the listener stayed live and the
        // next socket attached a *second* one — every frame dispatched twice.
        expect(emitter.removeCalls).toBe(1);
        expect(emitter.count(EVENT)).toBe(0);

        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        open(ws);
        deliverMessage(ws, 'once');
        expect(emitter.count(EVENT)).toBe(1);
        expect(onmessage).toHaveBeenCalledTimes(1);
    });

    it('disposes idempotently — a second teardown leaves other subscribers alone', () => {
        new WebSocket('wss://example.com');
        // A second subscriber on the same channel, standing in for another
        // package (or another copy of this one) sharing the emitter.
        const other = vi.fn();
        const disposeOther = subscribeNative(EVENT, other);
        expect(emitter.count(EVENT)).toBe(2);

        // The shape of the confirmed lynx-audio bug: an ordinary double
        // effect-cleanup. A disposer that isn't idempotent tears down state a
        // still-live subscriber depends on.
        __internal.reset();
        __internal.reset();

        // Exactly one removal reached the emitter — the second teardown was a
        // no-op, not a second `removeListener`.
        expect(emitter.removeCalls).toBe(1);
        expect(emitter.count(EVENT)).toBe(1);

        emitter.fire(EVENT, { id: 1, type: 'message', data: 'still delivered' });
        expect(other).toHaveBeenCalledTimes(1);

        disposeOther();
        disposeOther(); // also a no-op — C7 applies to core's disposer too
        expect(emitter.removeCalls).toBe(2);
    });

    it('keeps a throwing dispatch out of the emitter, so other listeners still run', () => {
        // A corrupt binary body makes `atob` raise InvalidCharacterError from
        // inside `_dispatch`. With the old raw `addListener` that escaped into
        // the emitter's dispatch loop and took every listener after it down.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        open(ws);

        const other = vi.fn();
        const disposeOther = subscribeNative(EVENT, other); // registered after ours

        expect(() => deliverBinary(ws, '!!not base64!!')).not.toThrow();
        expect(onmessage).not.toHaveBeenCalled();
        // The listener registered behind the throwing one still received it.
        expect(other).toHaveBeenCalledTimes(1);

        // And the channel still works afterwards.
        deliverMessage(ws, 'recovered');
        expect(onmessage).toHaveBeenCalledTimes(1);

        disposeOther();
        warn.mockRestore();
    });

    it('accepts the JSON-string payload form native can send', () => {
        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        const id = (ws as unknown as { _id: number })._id;
        emitter.fire(EVENT, JSON.stringify({ id, type: 'open' }));
        expect(ws.readyState).toBe(WebSocket.OPEN);
        emitter.fire(EVENT, JSON.stringify({ id, type: 'message', data: 'from-json' }));
        expect(onmessage.mock.calls[0]![0]!.data).toBe('from-json');
    });

    it('wires the payload guard into the subscription', () => {
        // The behavioural test below cannot fail: `sockets.get` misses and the
        // `switch` has no matching case, so a malformed event is a no-op with
        // or without the guard. Pin the wiring instead.
        expect(subscribeNativeCalls.length).toBeGreaterThan(0);
        expect(subscribeNativeCalls[0]![2]).toMatchObject({ validate: expect.any(Function) });
        const validate = (subscribeNativeCalls[0]![2] as { validate: (r: unknown) => boolean }).validate;
        expect(validate({ id: 1, type: 'open' })).toBe(true);
        expect(validate({ id: '1', type: 'open' })).toBe(false);
        expect(validate({ id: 1 })).toBe(false);
        expect(validate(null)).toBe(false);
    });

    it('keeps dispatch total when a malformed payload arrives', () => {
        const ws = new WebSocket('wss://example.com');
        const onmessage = vi.fn();
        ws.onmessage = onmessage;
        open(ws);
        const id = (ws as unknown as { _id: number })._id;

        // No id, non-numeric id, no type, unparseable string, primitive, null.
        expect(() => {
            emitter.fire(EVENT, { type: 'message', data: 'no id' });
            emitter.fire(EVENT, { id: String(id), type: 'message', data: 'string id' });
            emitter.fire(EVENT, { id, data: 'no type' });
            emitter.fire(EVENT, '{not json');
            emitter.fire(EVENT, 42);
            emitter.fire(EVENT, null);
        }).not.toThrow();
        expect(onmessage).not.toHaveBeenCalled();
    });

    it('does not latch when the emitter is absent, so a later socket still subscribes', () => {
        const lynxGlobal = globalThis as unknown as { lynx: unknown };
        const real = lynxGlobal.lynx;
        lynxGlobal.lynx = { getJSModule: () => undefined };
        try {
            new WebSocket('wss://example.com'); // off-device: nothing to attach to
            expect(emitter.addCalls).toBe(0);
        } finally {
            lynxGlobal.lynx = real;
        }

        // Emitter showed up late (it is injected by the runtime and the first
        // socket can race init) — the next one must still attach.
        const ws = new WebSocket('wss://example.com');
        expect(emitter.count(EVENT)).toBe(1);
        const onopen = vi.fn();
        ws.onopen = onopen;
        open(ws);
        expect(onopen).toHaveBeenCalledTimes(1);
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
