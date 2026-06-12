/**
 * `RTCPeerConnection` — W3C-shaped peer connection over the native module
 * (libwebrtc on Android and iOS).
 *
 * State getters are synchronous reads of JS caches fed by native
 * `*statechange` events. `localDescription` is additionally refreshed by
 * every `icegatheringstatechange` event (the payload piggy-backs the
 * current native SDP), so after gathering reaches `'complete'`,
 * `peer.localDescription.sdp` carries all candidates — exactly what a
 * non-trickle HTTP SDP exchange needs.
 */
import { callAsync, guardModule } from '@sigx/lynx-core';
import {
    MODULE,
    type NativeEvent,
    type RTCEventLike,
    RTCEventTargetBase,
    allocId,
    ensureSubscribed,
    registerDispatcher,
    unregisterDispatcher,
    unwrap,
} from './events.js';
import { RTCDataChannel } from './data-channel.js';
import { MediaStream, MediaStreamTrack } from './media.js';
import type {
    RTCConfiguration,
    RTCDataChannelInit,
    RTCIceCandidateInit,
    RTCIceConnectionState,
    RTCIceGatheringState,
    RTCOfferOptions,
    RTCPeerConnectionState,
    RTCSdpType,
    RTCSessionDescription,
    RTCSessionDescriptionInit,
    RTCSignalingState,
} from './types.js';

/**
 * Minimal sender returned by `addTrack` — enough to `removeTrack` and to
 * identify the outbound track. (`replaceTrack`/`getParameters` are
 * reserved for the video follow-up.)
 */
export interface RTCRtpSender {
    readonly track: MediaStreamTrack | null;
}

class RtpSender implements RTCRtpSender {
    constructor(
        readonly track: MediaStreamTrack | null,
        /** @internal resolves to the native senderId once addTrack lands. */
        readonly _idPromise: Promise<number>,
    ) {}
}

function makeDescription(type: RTCSdpType, sdp: string): RTCSessionDescription {
    return Object.freeze({
        type,
        sdp,
        toJSON() {
            return { type, sdp };
        },
    });
}

export class RTCPeerConnection extends RTCEventTargetBase {
    onconnectionstatechange: ((ev: RTCEventLike) => void) | null = null;
    oniceconnectionstatechange: ((ev: RTCEventLike) => void) | null = null;
    onicegatheringstatechange: ((ev: RTCEventLike) => void) | null = null;
    onsignalingstatechange: ((ev: RTCEventLike) => void) | null = null;
    onicecandidate: ((ev: RTCEventLike) => void) | null = null;
    ontrack: ((ev: RTCEventLike) => void) | null = null;
    ondatachannel: ((ev: RTCEventLike) => void) | null = null;

    private readonly _id: number;
    private _connectionState: RTCPeerConnectionState = 'new';
    private _iceConnectionState: RTCIceConnectionState = 'new';
    private _iceGatheringState: RTCIceGatheringState = 'new';
    private _signalingState: RTCSignalingState = 'stable';
    private _localDescription: RTCSessionDescription | null = null;
    private _remoteDescription: RTCSessionDescription | null = null;
    private readonly _dataChannels = new Set<RTCDataChannel>();
    private readonly _remoteTracks = new Set<MediaStreamTrack>();
    private readonly _remoteStreams = new Map<string, MediaStream>();
    private readonly _senders = new Set<RtpSender>();

    constructor(configuration?: RTCConfiguration) {
        super();
        guardModule(MODULE);
        this._id = allocId();
        registerDispatcher(this._id, evt => this._dispatch(evt));
        ensureSubscribed();

        callAsync(MODULE, 'createPeer', this._id, normalizeConfiguration(configuration))
            .then(unwrap)
            .catch(err => {
                console.warn('[WebRTC] createPeer failed:', err);
                this._dispatch({ id: this._id, type: 'connectionstatechange', state: 'failed' });
            });
    }

    get connectionState(): RTCPeerConnectionState {
        return this._connectionState;
    }

    get iceConnectionState(): RTCIceConnectionState {
        return this._iceConnectionState;
    }

    get iceGatheringState(): RTCIceGatheringState {
        return this._iceGatheringState;
    }

    get signalingState(): RTCSignalingState {
        return this._signalingState;
    }

    get localDescription(): RTCSessionDescription | null {
        return this._localDescription;
    }

    get remoteDescription(): RTCSessionDescription | null {
        return this._remoteDescription;
    }

    async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
        this._guardOpen('createOffer');
        return unwrap<RTCSessionDescriptionInit>(
            await callAsync(MODULE, 'createOffer', this._id, options ?? {}),
        );
    }

    async createAnswer(): Promise<RTCSessionDescriptionInit> {
        this._guardOpen('createAnswer');
        return unwrap<RTCSessionDescriptionInit>(
            await callAsync(MODULE, 'createAnswer', this._id, {}),
        );
    }

    /** No-arg form (implicit local description) is supported, per the modern spec. */
    async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
        this._guardOpen('setLocalDescription');
        const result = unwrap<{ type?: string; sdp?: string }>(
            await callAsync(MODULE, 'setLocalDescription', this._id, description ?? null),
        );
        // Native echoes the applied description (covers the implicit form).
        const type = (result?.type ?? description?.type) as RTCSdpType | undefined;
        const sdp = result?.sdp ?? description?.sdp;
        if (type && typeof sdp === 'string') {
            this._localDescription = makeDescription(type, sdp);
        }
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this._guardOpen('setRemoteDescription');
        unwrap(await callAsync(MODULE, 'setRemoteDescription', this._id, description));
        this._remoteDescription = makeDescription(description.type, description.sdp ?? '');
    }

    /** `null`/omitted candidate signals end-of-candidates, per W3C. */
    async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
        this._guardOpen('addIceCandidate');
        unwrap(await callAsync(MODULE, 'addIceCandidate', this._id, candidate ?? null));
    }

    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
        this._guardOpen('addTrack');
        for (const s of this._senders) {
            if (s.track === track) {
                throw new Error('InvalidAccessError: track has already been added to this connection.');
            }
        }
        const streamIds = streams.map(s => s.id);
        const idPromise = callAsync(MODULE, 'addTrack', this._id, track._handle, streamIds)
            .then(r => unwrap<{ senderId: number }>(r).senderId);
        idPromise.catch(err => console.warn('[WebRTC] addTrack failed:', err));
        const sender = new RtpSender(track, idPromise);
        this._senders.add(sender);
        return sender;
    }

    removeTrack(sender: RTCRtpSender): void {
        this._guardOpen('removeTrack');
        const impl = sender as RtpSender;
        if (!this._senders.has(impl)) return;
        this._senders.delete(impl);
        impl._idPromise
            .then(senderId => callAsync(MODULE, 'removeTrack', this._id, senderId))
            .then(unwrap)
            .catch(err => console.warn('[WebRTC] removeTrack failed:', err));
    }

    /** Synchronous, like W3C — the channel starts `'connecting'` and fires `open`. */
    createDataChannel(label: string, init?: RTCDataChannelInit): RTCDataChannel {
        this._guardOpen('createDataChannel');
        const dcId = allocId();
        const dc = new RTCDataChannel(dcId, label, init ?? {}, { state: 'connecting' });
        this._dataChannels.add(dc);
        callAsync(MODULE, 'createDataChannel', this._id, dcId, label, init ?? {})
            .then(unwrap)
            .catch(err => {
                dc.dispatchEvent({
                    type: 'error',
                    target: dc,
                    currentTarget: dc,
                    message: err instanceof Error ? err.message : String(err),
                });
                dc._closeLocally();
            });
        return dc;
    }

    close(): void {
        if (this._signalingState === 'closed') return;
        // Local transitions, no events — matches browser close() semantics.
        this._signalingState = 'closed';
        this._connectionState = 'closed';
        this._iceConnectionState = 'closed';
        unregisterDispatcher(this._id);
        for (const dc of this._dataChannels) dc._closeLocally();
        this._dataChannels.clear();
        for (const track of this._remoteTracks) track._endLocally(false);
        this._remoteTracks.clear();
        this._remoteStreams.clear();
        this._senders.clear();
        callAsync(MODULE, 'closePeer', this._id).catch(err => {
            console.warn('[WebRTC] closePeer failed:', err);
        });
    }

    // -- Internal -------------------------------------------------------------

    private _guardOpen(method: string): void {
        if (this._signalingState === 'closed') {
            throw new Error(`InvalidStateError: ${method} called on a closed RTCPeerConnection.`);
        }
    }

    /** @internal — called by the shared global-event subscriber. */
    private _dispatch(evt: NativeEvent): void {
        switch (evt.type) {
            case 'connectionstatechange': {
                this._connectionState = (evt.state as RTCPeerConnectionState) ?? this._connectionState;
                this._emit('connectionstatechange', this._event('connectionstatechange'));
                break;
            }
            case 'iceconnectionstatechange': {
                this._iceConnectionState =
                    (evt.state as RTCIceConnectionState) ?? this._iceConnectionState;
                this._emit('iceconnectionstatechange', this._event('iceconnectionstatechange'));
                break;
            }
            case 'icegatheringstatechange': {
                this._iceGatheringState =
                    (evt.state as RTCIceGatheringState) ?? this._iceGatheringState;
                if (typeof evt.sdp === 'string' && typeof evt.sdpType === 'string') {
                    this._localDescription = makeDescription(evt.sdpType as RTCSdpType, evt.sdp);
                }
                this._emit('icegatheringstatechange', this._event('icegatheringstatechange'));
                break;
            }
            case 'signalingstatechange': {
                this._signalingState = (evt.state as RTCSignalingState) ?? this._signalingState;
                this._emit('signalingstatechange', this._event('signalingstatechange'));
                break;
            }
            case 'icecandidate': {
                this._emit('icecandidate', {
                    ...this._event('icecandidate'),
                    candidate: evt.candidate ?? null,
                });
                break;
            }
            case 'track': {
                if (typeof evt.trackId !== 'number') return;
                const track = new MediaStreamTrack(
                    evt.trackId,
                    (evt.trackKind as 'audio' | 'video') ?? 'audio',
                    evt.trackLabel ?? '',
                    { remote: true, muted: evt.muted ?? false },
                );
                this._remoteTracks.add(track);
                const streams: MediaStream[] = [];
                for (const streamId of evt.streamIds ?? []) {
                    let stream = this._remoteStreams.get(streamId);
                    if (!stream) {
                        stream = new MediaStream(streamId);
                        this._remoteStreams.set(streamId, stream);
                    }
                    stream.addTrack(track);
                    streams.push(stream);
                }
                this._emit('track', { ...this._event('track'), track, streams });
                break;
            }
            case 'datachannel': {
                if (typeof evt.dcId !== 'number') return;
                const dc = new RTCDataChannel(
                    evt.dcId,
                    evt.label ?? '',
                    { ordered: evt.ordered ?? true, protocol: evt.protocol ?? '' },
                    // Starts 'connecting'; native emits dcopen right after
                    // announcing a channel that is already open.
                    { state: 'connecting', sctpId: evt.sctpId ?? null },
                );
                this._dataChannels.add(dc);
                this._emit('datachannel', { ...this._event('datachannel'), channel: dc });
                break;
            }
        }
    }

    private _event(type: string): RTCEventLike {
        return { type, target: this, currentTarget: this };
    }
}

/** Normalize `urls: string | string[]` so native always sees an array. */
function normalizeConfiguration(config?: RTCConfiguration): {
    iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
} {
    const servers = config?.iceServers ?? [];
    return {
        iceServers: servers.map(s => ({
            urls: Array.isArray(s.urls) ? s.urls : [s.urls],
            ...(s.username !== undefined ? { username: s.username } : {}),
            ...(s.credential !== undefined ? { credential: s.credential } : {}),
        })),
    };
}
