/**
 * The package's single native subscription (C7).
 *
 * Everything native sends arrives on one `__sigxWebRTCEvent` channel and is
 * demultiplexed by id, so this listener is a shared resource: whatever it does
 * wrong, it does to every peer connection, track and data channel at once —
 * and, because it shares the channel with any other listener the host has
 * registered, to those too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
    guardModule: vi.fn(),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', async importOriginal => {
    const actual = await importOriginal<typeof import('@sigx/lynx-core')>();
    return {
        ...actual,
        callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
        guardModule: (...args: unknown[]) => bridge.guardModule(...(args as [])),
        isModuleAvailable: (...args: unknown[]) => bridge.isModuleAvailable(...(args as [])),
    };
});

type Listener = (...a: unknown[]) => void;

/**
 * Fake `GlobalEventEmitter`.
 *
 * Listeners live in an array and `removeListener` splices by index *without*
 * guarding a miss — a host shape core's `subscribeNative` docblock calls out
 * explicitly ("`removeListener` on an already-removed handler is not
 * guaranteed to be harmless on every host"): a second removal splices at -1
 * and takes an unrelated listener with it. A Set-backed fake would swallow a
 * double removal and make the idempotency test below unfalsifiable.
 */
function fakeEmitter() {
    const listeners = new Map<string, Listener[]>();
    return {
        /** How many times the code under test asked to detach. */
        removeCalls: 0,
        count(channel: string): number {
            return listeners.get(channel)?.length ?? 0;
        },
        /** Sequential dispatch, like the native emitter — a thrower ends it. */
        fire(channel: string, payload: unknown): void {
            for (const fn of listeners.get(channel) ?? []) fn(payload);
        },
        addListener(name: string, fn: Listener): void {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name)!.push(fn);
        },
        removeListener(name: string, fn: Listener): void {
            this.removeCalls++;
            const list = listeners.get(name);
            if (!list) return;
            list.splice(list.indexOf(fn), 1);
        },
    };
}

let emitter = fakeEmitter();

(globalThis as unknown as { lynx: unknown }).lynx = {
    getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
};

const { RTCPeerConnection } = await import('../src/peer-connection.js');
const { EVENT_NAME, __internal, ensureSubscribed, registerDispatcher, subscribeToNativeEvents } =
    await import('../src/events.js');

beforeEach(() => {
    emitter = fakeEmitter();
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.guardModule.mockClear();
});

afterEach(() => {
    __internal.reset();
});

describe('the native subscription disposer (C7)', () => {
    it('detaches exactly once, however often it is called', () => {
        const first = vi.fn();
        const second = vi.fn();
        const offFirst = subscribeToNativeEvents(first);
        subscribeToNativeEvents(second);
        expect(emitter.count(EVENT_NAME)).toBe(2);

        // An effect cleanup firing twice (unmount plus an explicit teardown) is
        // ordinary; it must not reach the emitter twice.
        offFirst();
        offFirst();
        offFirst();

        emitter.fire(EVENT_NAME, { id: 1, type: 'dcopen' });
        expect(first).not.toHaveBeenCalled();
        // The listener nobody disposed is still subscribed and still fed.
        expect(second).toHaveBeenCalledTimes(1);
        expect(emitter.count(EVENT_NAME)).toBe(1);
        expect(emitter.removeCalls).toBe(1);
    });

    it('is a `() => void`, not a `{ remove() }` handle', () => {
        const off = subscribeToNativeEvents(vi.fn());
        expect(typeof off).toBe('function');
        expect(off()).toBeUndefined();
    });

    it('tears the module listener down on reset without touching other subscribers', () => {
        ensureSubscribed();
        const other = vi.fn();
        subscribeToNativeEvents(other);
        expect(emitter.count(EVENT_NAME)).toBe(2);

        __internal.reset();
        __internal.reset();

        expect(__internal.subscribed).toBe(false);
        expect(emitter.count(EVENT_NAME)).toBe(1);
        emitter.fire(EVENT_NAME, { id: 1, type: 'dcopen' });
        expect(other).toHaveBeenCalledTimes(1);
    });

    it('subscribes once no matter how many entities are created', () => {
        const peers = [new RTCPeerConnection(), new RTCPeerConnection(), new RTCPeerConnection()];
        expect(peers).toHaveLength(3);
        expect(emitter.count(EVENT_NAME)).toBe(1);
    });
});

describe('demux payload handling', () => {
    function dispatcherFor(id: number) {
        const spy = vi.fn();
        ensureSubscribed();
        registerDispatcher(id, spy);
        return spy;
    }

    it('routes an object payload to the entity that owns the id', () => {
        const spy = dispatcherFor(7);
        emitter.fire(EVENT_NAME, { id: 7, type: 'dcopen', sctpId: 3 });
        expect(spy).toHaveBeenCalledWith({ id: 7, type: 'dcopen', sctpId: 3 });
    });

    it('parses a payload delivered as a JSON string', () => {
        // The native bridge stringifies on some hosts; dropping that branch
        // would silently kill every event on those builds.
        const spy = dispatcherFor(8);
        emitter.fire(EVENT_NAME, JSON.stringify({ id: 8, type: 'dcclose' }));
        expect(spy).toHaveBeenCalledWith({ id: 8, type: 'dcclose' });
    });

    it('drops payloads that cannot be routed instead of dispatching them', () => {
        const spy = dispatcherFor(9);
        emitter.fire(EVENT_NAME, { type: 'dcopen' }); // no id
        emitter.fire(EVENT_NAME, { id: '9', type: 'dcopen' }); // id of the wrong type
        emitter.fire(EVENT_NAME, { id: 9 }); // no type for _dispatch to switch on
        emitter.fire(EVENT_NAME, '{ not json'); // unparseable
        emitter.fire(EVENT_NAME, 9); // not an object at all
        emitter.fire(EVENT_NAME, null);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('a dispatcher that throws', () => {
    it('does not abort delivery to the rest of the channel', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events');
        const handle = (dc as unknown as { _handle: number })._handle;
        emitter.fire(EVENT_NAME, { id: handle, type: 'dcopen', sctpId: 1 });

        // Registered after the module's demux listener, so it only ever runs if
        // the demux hands control back.
        const later = vi.fn();
        subscribeToNativeEvents(later);

        // A corrupt binary body: base64 decoding throws part-way through
        // `_dispatch`, before the handler try/catch in RTCEventTargetBase.
        expect(() =>
            emitter.fire(EVENT_NAME, {
                id: handle,
                type: 'dcmessage',
                isBinary: true,
                binary: '!!not base64!!',
            }),
        ).not.toThrow();

        expect(later).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('keeps the module working for the next event', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events');
        const handle = (dc as unknown as { _handle: number })._handle;
        emitter.fire(EVENT_NAME, { id: handle, type: 'dcopen', sctpId: 1 });
        const onmessage = vi.fn();
        dc.onmessage = onmessage;

        emitter.fire(EVENT_NAME, {
            id: handle,
            type: 'dcmessage',
            isBinary: true,
            binary: '!!not base64!!',
        });
        emitter.fire(EVENT_NAME, { id: handle, type: 'dcmessage', data: 'still here' });

        expect(onmessage).toHaveBeenCalledTimes(1);
        expect(onmessage.mock.calls[0]![0]!.data).toBe('still here');
        warn.mockRestore();
    });
});
