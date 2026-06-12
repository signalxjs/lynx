/**
 * @sigx/lynx-webrtc — W3C-shaped WebRTC for sigx-lynx.
 *
 * Peer connections, microphone audio tracks, and data channels backed by
 * libwebrtc. Code written against browser WebRTC ports nearly unchanged:
 *
 * ```ts
 * import { RTCPeerConnection, mediaDevices } from '@sigx/lynx-webrtc';
 *
 * const stream = await mediaDevices.getUserMedia({ audio: true });
 * const peer = new RTCPeerConnection();
 * peer.addTrack(stream.getAudioTracks()[0], stream);
 * const dc = peer.createDataChannel('events');
 * const offer = await peer.createOffer();
 * await peer.setLocalDescription(offer);
 * // … exchange SDP with the remote end, then:
 * await peer.setRemoteDescription({ type: 'answer', sdp });
 * ```
 *
 * Remote audio tracks play automatically through the device's audio
 * output — there is no element to attach.
 *
 * @packageDocumentation
 */

export { RTCPeerConnection } from './peer-connection.js';
export type { RTCRtpSender } from './peer-connection.js';
export { RTCDataChannel } from './data-channel.js';
export { MediaStream, MediaStreamTrack, mediaDevices } from './media.js';
export type { MediaStreamConstraints, MediaTrackConstraintSet } from './media.js';
export { WebRTC, isWebRTCAvailable } from './audio-output.js';
export type {
    AudioOutputRoute,
    MediaStreamTrackState,
    RTCConfiguration,
    RTCDataChannelInit,
    RTCDataChannelState,
    RTCIceCandidateInit,
    RTCIceConnectionState,
    RTCIceGatheringState,
    RTCIceServer,
    RTCOfferOptions,
    RTCPeerConnectionState,
    RTCSdpType,
    RTCSessionDescription,
    RTCSessionDescriptionInit,
    RTCSignalingState,
} from './types.js';
