/**
 * W3C-shaped WebRTC dictionaries and state unions.
 *
 * These mirror the standard `lib.dom.d.ts` shapes (module-scoped, so they
 * shadow the DOM globals inside this package) — code written against
 * browser WebRTC type-checks against this subset unchanged.
 */

export interface RTCIceServer {
    urls: string | string[];
    username?: string;
    credential?: string;
}

export interface RTCConfiguration {
    iceServers?: RTCIceServer[];
}

export type RTCSdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';

export interface RTCSessionDescriptionInit {
    type: RTCSdpType;
    sdp?: string;
}

/**
 * The frozen `{ type, sdp }` returned by `localDescription` /
 * `remoteDescription`. Plain object with `toJSON()` — there is no
 * `RTCSessionDescription` constructor (init dicts are accepted everywhere,
 * per the modern spec).
 */
export interface RTCSessionDescription {
    readonly type: RTCSdpType;
    readonly sdp: string;
    toJSON(): { type: RTCSdpType; sdp: string };
}

export interface RTCIceCandidateInit {
    candidate?: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
}

export interface RTCDataChannelInit {
    ordered?: boolean;
    maxPacketLifeTime?: number;
    maxRetransmits?: number;
    protocol?: string;
    negotiated?: boolean;
    id?: number;
}

export interface RTCOfferOptions {
    offerToReceiveAudio?: boolean;
    iceRestart?: boolean;
}

export type RTCPeerConnectionState =
    | 'new'
    | 'connecting'
    | 'connected'
    | 'disconnected'
    | 'failed'
    | 'closed';

export type RTCIceConnectionState =
    | 'new'
    | 'checking'
    | 'connected'
    | 'completed'
    | 'disconnected'
    | 'failed'
    | 'closed';

export type RTCIceGatheringState = 'new' | 'gathering' | 'complete';

export type RTCSignalingState =
    | 'stable'
    | 'have-local-offer'
    | 'have-remote-offer'
    | 'have-local-pranswer'
    | 'have-remote-pranswer'
    | 'closed';

export type RTCDataChannelState = 'connecting' | 'open' | 'closing' | 'closed';

export type MediaStreamTrackState = 'live' | 'ended';

/** Audio output route — non-W3C extension (see `WebRTC.setAudioOutput`). */
export type AudioOutputRoute = 'speaker' | 'earpiece';
