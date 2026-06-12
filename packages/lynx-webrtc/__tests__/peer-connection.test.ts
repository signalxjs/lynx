/**
 * Unit tests for `RTCPeerConnection`. Mocks `@sigx/lynx-core` (keeping the
 * real base64 helpers) so the bridge is driven entirely in-process; the
 * real native stack is exercised by the showcase loopback demo.
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
const { MediaStream, MediaStreamTrack } = await import('../src/media.js');
const { __internal } = await import('../src/events.js');

const EVENT = '__sigxWebRTCEvent';

function idOf(peer: InstanceType<typeof RTCPeerConnection>): number {
    return (peer as unknown as { _id: number })._id;
}

function fire(id: number, payload: Record<string, unknown>): void {
    emitter.fire(EVENT, { id, ...payload });
}

function callOf(method: string, id?: number): unknown[] | undefined {
    return bridge.callAsync.mock.calls.find(
        c => c[1] === method && (id === undefined || c[2] === id),
    );
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => undefined);
    bridge.guardModule.mockClear();
    bridge.isModuleAvailable.mockClear();
});

afterEach(() => {
    emitter.listeners.clear();
    __internal.reset();
});

describe('RTCPeerConnection — construction', () => {
    it('guards the native module and starts in pristine state', () => {
        const peer = new RTCPeerConnection();
        expect(bridge.guardModule).toHaveBeenCalledWith('WebRTC');
        expect(peer.connectionState).toBe('new');
        expect(peer.iceConnectionState).toBe('new');
        expect(peer.iceGatheringState).toBe('new');
        expect(peer.signalingState).toBe('stable');
        expect(peer.localDescription).toBeNull();
        expect(peer.remoteDescription).toBeNull();
    });

    it('calls createPeer with an empty normalized config by default', () => {
        const peer = new RTCPeerConnection();
        expect(callOf('createPeer', idOf(peer))![3]).toEqual({ iceServers: [] });
    });

    it('normalizes iceServers urls (string → array) and keeps credentials', () => {
        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.example.com' },
                { urls: ['turn:turn.example.com'], username: 'u', credential: 'c' },
            ],
        });
        expect(callOf('createPeer', idOf(peer))![3]).toEqual({
            iceServers: [
                { urls: ['stun:stun.example.com'] },
                { urls: ['turn:turn.example.com'], username: 'u', credential: 'c' },
            ],
        });
    });

    it('flags the connection failed when native createPeer rejects', async () => {
        bridge.callAsync.mockImplementationOnce(async () => {
            throw new Error('bridge down');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const peer = new RTCPeerConnection();
        const onchange = vi.fn();
        peer.onconnectionstatechange = onchange;
        await flush();
        expect(peer.connectionState).toBe('failed');
        expect(onchange).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('RTCPeerConnection — SDP negotiation', () => {
    it('createOffer resolves the native description and forwards options', async () => {
        const peer = new RTCPeerConnection();
        bridge.callAsync.mockImplementationOnce(async () => ({ type: 'offer', sdp: 'v=0\r\n' }));
        const offer = await peer.createOffer({ offerToReceiveAudio: true });
        expect(offer).toEqual({ type: 'offer', sdp: 'v=0\r\n' });
        expect(callOf('createOffer', idOf(peer))![3]).toEqual({ offerToReceiveAudio: true });
    });

    it('createOffer rejects on a native { error } result', async () => {
        const peer = new RTCPeerConnection();
        bridge.callAsync.mockImplementationOnce(async () => ({ error: 'no factory' }));
        await expect(peer.createOffer()).rejects.toThrow('no factory');
    });

    it('setLocalDescription caches the applied description', async () => {
        const peer = new RTCPeerConnection();
        await peer.setLocalDescription({ type: 'offer', sdp: 'v=0\r\n' });
        expect(peer.localDescription?.type).toBe('offer');
        expect(peer.localDescription?.sdp).toBe('v=0\r\n');
        expect(peer.localDescription?.toJSON()).toEqual({ type: 'offer', sdp: 'v=0\r\n' });
    });

    it('setLocalDescription() no-arg form passes null and caches the native echo', async () => {
        const peer = new RTCPeerConnection();
        bridge.callAsync.mockImplementationOnce(async () => ({ type: 'offer', sdp: 'implicit' }));
        await peer.setLocalDescription();
        expect(callOf('setLocalDescription', idOf(peer))![3]).toBeNull();
        expect(peer.localDescription?.sdp).toBe('implicit');
    });

    it('setRemoteDescription caches and addIceCandidate passes through', async () => {
        const peer = new RTCPeerConnection();
        await peer.setRemoteDescription({ type: 'answer', sdp: 'remote' });
        expect(peer.remoteDescription?.type).toBe('answer');

        await peer.addIceCandidate({ candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 });
        expect(callOf('addIceCandidate', idOf(peer))![3]).toEqual({
            candidate: 'candidate:1',
            sdpMid: '0',
            sdpMLineIndex: 0,
        });

        await peer.addIceCandidate(null); // end of candidates
        const calls = bridge.callAsync.mock.calls.filter(c => c[1] === 'addIceCandidate');
        expect(calls[1]![3]).toBeNull();
    });
});

describe('RTCPeerConnection — state events', () => {
    it('updates getters and fires handlers on *statechange events', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const seen: string[] = [];
        peer.onconnectionstatechange = () => seen.push(`conn:${peer.connectionState}`);
        peer.oniceconnectionstatechange = () => seen.push(`ice:${peer.iceConnectionState}`);
        peer.onsignalingstatechange = () => seen.push(`sig:${peer.signalingState}`);

        fire(id, { type: 'signalingstatechange', state: 'have-local-offer' });
        fire(id, { type: 'iceconnectionstatechange', state: 'checking' });
        fire(id, { type: 'connectionstatechange', state: 'connecting' });
        fire(id, { type: 'connectionstatechange', state: 'connected' });

        expect(seen).toEqual(['sig:have-local-offer', 'ice:checking', 'conn:connecting', 'conn:connected']);
    });

    it('refreshes localDescription from the icegatheringstatechange payload', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const states: string[] = [];
        peer.onicegatheringstatechange = () => states.push(peer.iceGatheringState);

        fire(id, { type: 'icegatheringstatechange', state: 'gathering', sdpType: 'offer', sdp: 'partial' });
        expect(peer.localDescription?.sdp).toBe('partial');

        fire(id, { type: 'icegatheringstatechange', state: 'complete', sdpType: 'offer', sdp: 'full-sdp' });
        expect(peer.iceGatheringState).toBe('complete');
        expect(peer.localDescription?.sdp).toBe('full-sdp');
        expect(states).toEqual(['gathering', 'complete']);
    });

    it('fires onicecandidate with the candidate and with null at end-of-candidates', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const candidates: unknown[] = [];
        peer.onicecandidate = ev => candidates.push(ev.candidate);

        fire(id, { type: 'icecandidate', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } });
        fire(id, { type: 'icecandidate', candidate: null });

        expect(candidates).toEqual([
            { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
            null,
        ]);
    });
});

describe('RTCPeerConnection — remote tracks', () => {
    it('synthesizes track + stream wrappers from the native track event', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const ontrack = vi.fn();
        peer.ontrack = ontrack;

        fire(id, {
            type: 'track',
            trackId: -3,
            trackKind: 'audio',
            trackLabel: 'remote-audio',
            streamIds: ['srv-stream-1'],
            muted: false,
        });

        expect(ontrack).toHaveBeenCalledTimes(1);
        const ev = ontrack.mock.calls[0]![0]!;
        const track = ev.track as InstanceType<typeof MediaStreamTrack>;
        expect(track.id).toBe('-3');
        expect(track.kind).toBe('audio');
        expect(track.remote).toBe(true);
        expect(track.readyState).toBe('live');
        const streams = ev.streams as InstanceType<typeof MediaStream>[];
        expect(streams).toHaveLength(1);
        expect(streams[0]!.id).toBe('srv-stream-1');
        expect(streams[0]!.getAudioTracks()).toEqual([track]);
    });

    it('reuses the same MediaStream wrapper for a repeated stream id', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const ontrack = vi.fn();
        peer.ontrack = ontrack;

        fire(id, { type: 'track', trackId: -1, trackKind: 'audio', streamIds: ['s'], muted: false });
        fire(id, { type: 'track', trackId: -2, trackKind: 'audio', streamIds: ['s'], muted: false });

        const first = ontrack.mock.calls[0]![0]!.streams[0];
        const second = ontrack.mock.calls[1]![0]!.streams[0];
        expect(first).toBe(second);
        expect(first.getTracks()).toHaveLength(2);
    });

    it('routes trackended/trackmuted events to the remote track', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const ontrack = vi.fn();
        peer.ontrack = ontrack;
        fire(id, { type: 'track', trackId: -5, trackKind: 'audio', streamIds: [], muted: false });
        const track = ontrack.mock.calls[0]![0]!.track as InstanceType<typeof MediaStreamTrack>;

        const onmute = vi.fn();
        const onended = vi.fn();
        track.onmute = onmute;
        track.onended = onended;

        fire(-5, { type: 'trackmuted' });
        expect(track.muted).toBe(true);
        expect(onmute).toHaveBeenCalledTimes(1);

        fire(-5, { type: 'trackended' });
        expect(track.readyState).toBe('ended');
        expect(onended).toHaveBeenCalledTimes(1);
    });
});

describe('RTCPeerConnection — outbound tracks', () => {
    function makeLocalTrack(): InstanceType<typeof MediaStreamTrack> {
        return new MediaStreamTrack(101, 'audio', 'mic', { remote: false });
    }

    it('addTrack calls native with the track handle and stream ids', () => {
        const peer = new RTCPeerConnection();
        const track = makeLocalTrack();
        const stream = new MediaStream([track]);
        const sender = peer.addTrack(track, stream);
        expect(sender.track).toBe(track);
        const call = callOf('addTrack', idOf(peer))!;
        expect(call[3]).toBe(101);
        expect(call[4]).toEqual([stream.id]);
    });

    it('rejects adding the same track twice', () => {
        const peer = new RTCPeerConnection();
        const track = makeLocalTrack();
        peer.addTrack(track);
        expect(() => peer.addTrack(track)).toThrow(/InvalidAccessError/);
    });

    it('removeTrack resolves the native senderId before calling native', async () => {
        const peer = new RTCPeerConnection();
        const track = makeLocalTrack();
        bridge.callAsync.mockImplementation(async (...args: unknown[]) =>
            args[1] === 'addTrack' ? { senderId: 7 } : undefined,
        );
        const sender = peer.addTrack(track);
        peer.removeTrack(sender);
        await flush();
        const call = callOf('removeTrack', idOf(peer))!;
        expect(call[3]).toBe(7);
    });
});

describe('RTCPeerConnection — close', () => {
    it('closes states, native peer, and child channels; further calls throw', async () => {
        const peer = new RTCPeerConnection();
        const dc = peer.createDataChannel('events');
        fire((dc as unknown as { _handle: number })._handle, { type: 'dcopen', sctpId: 1 });
        const onclose = vi.fn();
        dc.onclose = onclose;

        peer.close();

        expect(peer.connectionState).toBe('closed');
        expect(peer.signalingState).toBe('closed');
        expect(peer.iceConnectionState).toBe('closed');
        expect(callOf('closePeer', idOf(peer))).toBeDefined();
        expect(dc.readyState).toBe('closed');
        expect(onclose).toHaveBeenCalledTimes(1);

        await expect(peer.createOffer()).rejects.toThrow(/InvalidStateError/);
        expect(() => peer.createDataChannel('x')).toThrow(/InvalidStateError/);
        expect(() => peer.close()).not.toThrow(); // idempotent
    });

    it('ignores native events after close', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        peer.close();
        const onchange = vi.fn();
        peer.onconnectionstatechange = onchange;
        fire(id, { type: 'connectionstatechange', state: 'connected' });
        expect(peer.connectionState).toBe('closed');
        expect(onchange).not.toHaveBeenCalled();
    });
});

describe('RTCPeerConnection — remote data channels', () => {
    it('announces native-created channels via ondatachannel', () => {
        const peer = new RTCPeerConnection();
        const id = idOf(peer);
        const ondatachannel = vi.fn();
        peer.ondatachannel = ondatachannel;

        fire(id, { type: 'datachannel', dcId: -8, label: 'srv', protocol: 'p', ordered: true, sctpId: 2 });
        const channel = ondatachannel.mock.calls[0]![0]!.channel;
        expect(channel.label).toBe('srv');
        expect(channel.protocol).toBe('p');
        expect(channel.readyState).toBe('connecting');
        expect(channel.id).toBeNull(); // null until open, same as local channels

        fire(-8, { type: 'dcopen', sctpId: 2 });
        expect(channel.readyState).toBe('open');
        expect(channel.id).toBe(2);
    });
});
