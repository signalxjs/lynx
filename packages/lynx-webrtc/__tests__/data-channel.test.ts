/**
 * Unit tests for `RTCDataChannel` (created through `RTCPeerConnection`,
 * the only public path). Bridge mocked as in peer-connection.test.ts.
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
    getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
};

const { RTCPeerConnection } = await import('../src/peer-connection.js');
const { RTCDataChannel } = await import('../src/data-channel.js');
const { __internal } = await import('../src/events.js');

const EVENT = '__sigxWebRTCEvent';

function handleOf(dc: InstanceType<typeof RTCDataChannel>): number {
    return (dc as unknown as { _handle: number })._handle;
}

function fire(id: number, payload: Record<string, unknown>): void {
    emitter.fire(EVENT, { id, ...payload });
}

function callOf(method: string, id?: number): unknown[] | undefined {
    return bridge.callAsync.mock.calls.find(
        c => c[1] === method && (id === undefined || c[2] === id),
    );
}

function openChannel(label = 'events', init?: Record<string, unknown>) {
    const peer = new RTCPeerConnection();
    const dc = peer.createDataChannel(label, init);
    fire(handleOf(dc), { type: 'dcopen', sctpId: 1 });
    return { peer, dc };
}

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.guardModule.mockClear();
});

afterEach(() => {
    emitter.listeners.clear();
    __internal.reset();
});

describe('RTCDataChannel — creation', () => {
    it('returns synchronously in connecting state and calls native', () => {
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events', { ordered: false, protocol: 'json' });
        expect(dc.readyState).toBe('connecting');
        expect(dc.label).toBe('events');
        expect(dc.ordered).toBe(false);
        expect(dc.protocol).toBe('json');
        expect(dc.id).toBeNull();
        expect(dc.binaryType).toBe('arraybuffer');

        const call = callOf('createDataChannel')!;
        expect(call[3]).toBe(handleOf(dc));
        expect(call[4]).toBe('events');
        expect(call[5]).toEqual({ ordered: false, protocol: 'json' });
    });

    it('opens on dcopen, exposing the SCTP stream id', () => {
        const { dc } = openChannel();
        expect(dc.readyState).toBe('open');
        expect(dc.id).toBe(1);
    });

    it('fires onopen once', () => {
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events');
        const onopen = vi.fn();
        dc.onopen = onopen;
        fire(handleOf(dc), { type: 'dcopen', sctpId: 4 });
        fire(handleOf(dc), { type: 'dcopen', sctpId: 4 });
        expect(onopen).toHaveBeenCalledTimes(1);
    });

    it('errors and closes locally when native createDataChannel rejects', async () => {
        const peer = new RTCPeerConnection();
        bridge.callAsync.mockImplementation(async (...args: unknown[]) => {
            if (args[1] === 'createDataChannel') throw new Error('no sctp');
            return undefined;
        });
        const dc = peer.createDataChannel('events');
        const onerror = vi.fn();
        const onclose = vi.fn();
        dc.onerror = onerror;
        dc.onclose = onclose;
        await Promise.resolve();
        await Promise.resolve();
        expect(onerror).toHaveBeenCalledTimes(1);
        expect(onclose).toHaveBeenCalledTimes(1);
        expect(dc.readyState).toBe('closed');
    });
});

describe('RTCDataChannel — send', () => {
    it('throws while connecting and after close', () => {
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events');
        expect(() => dc.send('early')).toThrow(/InvalidStateError/);

        fire(handleOf(dc), { type: 'dcopen', sctpId: 1 });
        fire(handleOf(dc), { type: 'dcclose' });
        expect(() => dc.send('late')).toThrow(/InvalidStateError/);
    });

    it('sends strings as text', () => {
        const { dc } = openChannel();
        dc.send('{"op":"ping"}');
        const call = callOf('dcSend', handleOf(dc))!;
        expect(call[3]).toBe('{"op":"ping"}');
        expect(call[4]).toBe(false);
    });

    it('base64-encodes ArrayBuffers and views (honoring the view range)', () => {
        const { dc } = openChannel();
        dc.send(new Uint8Array([0x01, 0x02, 0x03]).buffer);
        let call = callOf('dcSend', handleOf(dc))!;
        expect(call[3]).toBe('AQID');
        expect(call[4]).toBe(true);

        bridge.callAsync.mockClear();
        const raw = new Uint8Array([0xff, 0x01, 0x02, 0x03, 0xff]);
        dc.send(new Uint8Array(raw.buffer, 1, 3));
        call = callOf('dcSend', handleOf(dc))!;
        expect(call[3]).toBe('AQID');
    });

    it('dispatches an error event when native resolves { error }', async () => {
        const { dc } = openChannel();
        const onerror = vi.fn();
        dc.onerror = onerror;
        bridge.callAsync.mockImplementationOnce(async () => ({ error: 'sctp send failed' }));
        dc.send('doomed');
        await Promise.resolve();
        await Promise.resolve();
        expect(onerror).toHaveBeenCalledTimes(1);
        expect(onerror.mock.calls[0]![0]!.message).toBe('sctp send failed');
    });

    it('tracks bufferedAmount as a write-through counter', () => {
        const { dc } = openChannel();
        dc.send('abc'); // 3 utf-8 bytes
        dc.send(new Uint8Array([1, 2, 3, 4]).buffer); // 4 bytes
        expect(dc.bufferedAmount).toBe(7);
    });
});

describe('RTCDataChannel — receive', () => {
    it('delivers text messages as strings', () => {
        const { dc } = openChannel();
        const onmessage = vi.fn();
        dc.onmessage = onmessage;
        fire(handleOf(dc), { type: 'dcmessage', data: 'hello', isBinary: false });
        expect(onmessage.mock.calls[0]![0]!.data).toBe('hello');
    });

    it('decodes binary messages to ArrayBuffer', () => {
        const { dc } = openChannel();
        const onmessage = vi.fn();
        dc.onmessage = onmessage;
        fire(handleOf(dc), { type: 'dcmessage', binary: 'AQID', isBinary: true });
        const data = onmessage.mock.calls[0]![0]!.data as ArrayBuffer;
        expect(data).toBeInstanceOf(ArrayBuffer);
        expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]);
    });

    it('drops messages before open', () => {
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events');
        const onmessage = vi.fn();
        dc.onmessage = onmessage;
        fire(handleOf(dc), { type: 'dcmessage', data: 'early', isBinary: false });
        expect(onmessage).not.toHaveBeenCalled();
    });

    it('fires onerror for dcerror events', () => {
        const { dc } = openChannel();
        const onerror = vi.fn();
        dc.onerror = onerror;
        fire(handleOf(dc), { type: 'dcerror', message: 'sctp reset' });
        expect(onerror.mock.calls[0]![0]!.message).toBe('sctp reset');
    });
});

describe('RTCDataChannel — close', () => {
    it('close() calls native and settles on the dcclose event', () => {
        const { dc } = openChannel();
        const onclose = vi.fn();
        dc.onclose = onclose;
        dc.close();
        expect(dc.readyState).toBe('closing');
        expect(callOf('dcClose', handleOf(dc))).toBeDefined();
        fire(handleOf(dc), { type: 'dcclose' });
        expect(dc.readyState).toBe('closed');
        expect(onclose).toHaveBeenCalledTimes(1);
    });

    it('close() is idempotent and dcclose fires once', () => {
        const { dc } = openChannel();
        const onclose = vi.fn();
        dc.onclose = onclose;
        dc.close();
        const calls = bridge.callAsync.mock.calls.length;
        dc.close();
        expect(bridge.callAsync.mock.calls.length).toBe(calls);
        fire(handleOf(dc), { type: 'dcclose' });
        fire(handleOf(dc), { type: 'dcclose' });
        expect(onclose).toHaveBeenCalledTimes(1);
    });
});
