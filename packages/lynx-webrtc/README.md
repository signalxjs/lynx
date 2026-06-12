# @sigx/lynx-webrtc

W3C-shaped WebRTC for sigx-lynx: peer connections, microphone audio tracks, and
data channels, backed by libwebrtc ([webrtc-sdk](https://github.com/webrtc-sdk)
builds). Code written against browser WebRTC ports nearly unchanged.

> **Platforms:** Android. iOS support is tracked in
> [signalxjs/lynx#479](https://github.com/signalxjs/lynx/issues/479).
> Not available on the web runtime (the background thread has no
> `RTCPeerConnection`) — gate with `isWebRTCAvailable()`.

## Install

```sh
pnpm add @sigx/lynx-webrtc
sigx prebuild
```

Autolinking adds the native SDK dependency, the `RECORD_AUDIO` /
`MODIFY_AUDIO_SETTINGS` permissions, and the microphone usage description for
you. Note the native SDK adds roughly 5–10 MB per ABI to the app.

## Usage

```ts
import { RTCPeerConnection, mediaDevices } from '@sigx/lynx-webrtc';

// 1. Capture the mic (shows the OS permission prompt when needed).
const stream = await mediaDevices.getUserMedia({ audio: true });
const [micTrack] = stream.getAudioTracks();

// 2. Wire up a peer connection.
const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.example.com' }] });
peer.addTrack(micTrack, stream);
const events = peer.createDataChannel('events');
events.onmessage = e => console.log('peer says', e.data);

// 3. Negotiate. For an HTTP (non-trickle) SDP exchange, wait for ICE
//    gathering to complete so localDescription carries every candidate.
const offer = await peer.createOffer();
await peer.setLocalDescription(offer);
await new Promise<void>(resolve => {
    if (peer.iceGatheringState === 'complete') return resolve();
    peer.onicegatheringstatechange = () => {
        if (peer.iceGatheringState === 'complete') resolve();
    };
});
const answerSdp = await postOfferSomewhere(peer.localDescription!.sdp);
await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });

// 4. Remote audio plays automatically — no element to attach.
peer.ontrack = e => console.log('remote track', e.track.id);

// Mute / hang up.
micTrack.enabled = false;
peer.close();
micTrack.stop();
```

## API

### `mediaDevices.getUserMedia(constraints)`

Audio only (`{ audio: true }`). Rejects with `NotAllowedError` when the
microphone permission is denied and `NotSupportedError` for video constraints.

### `RTCPeerConnection`

| Member | Notes |
|---|---|
| `new RTCPeerConnection(config?)` | `config.iceServers` supported (`urls` string or array, `username`, `credential`) |
| `createOffer(options?)` / `createAnswer()` | resolves `{ type, sdp }` |
| `setLocalDescription(desc?)` / `setRemoteDescription(desc)` | no-arg implicit form supported |
| `addIceCandidate(candidate?)` | `null`/omitted = end-of-candidates |
| `addTrack(track, ...streams)` → `RTCRtpSender` | minimal sender (`{ track }`) |
| `removeTrack(sender)` | |
| `createDataChannel(label, init?)` | synchronous, like W3C |
| `close()` | also ends remote tracks and closes child channels |
| `connectionState` / `iceConnectionState` / `iceGatheringState` / `signalingState` | sync getters |
| `localDescription` / `remoteDescription` | `localDescription` is refreshed on every `icegatheringstatechange`, so it carries the full SDP once gathering completes |
| `onconnectionstatechange` / `oniceconnectionstatechange` / `onicegatheringstatechange` / `onsignalingstatechange` | |
| `onicecandidate` | `ev.candidate` is `null` at end-of-candidates |
| `ontrack` | `ev.track`, `ev.streams` (no `receiver`/`transceiver`) |
| `ondatachannel` | `ev.channel` |

### `RTCDataChannel`

`label`, `ordered`, `protocol`, `id` (SCTP stream id, `null` until open),
`readyState`, `bufferedAmount` (write-through approximation),
`binaryType: 'arraybuffer'`, `send(string | ArrayBuffer | view)`, `close()`,
`onopen` / `onmessage` / `onclose` / `onerror`.

### `MediaStreamTrack` / `MediaStream`

`track.enabled = false` mutes without stopping capture; `track.stop()` releases
the capturer. `stream.getAudioTracks()` etc. are JS-side bookkeeping; the
stream's `id` is what appears as the msid in SDP.

### Extras (non-W3C)

```ts
import { WebRTC, isWebRTCAvailable } from '@sigx/lynx-webrtc';

await WebRTC.setAudioOutput('earpiece');     // default route is 'speaker'
const { status } = await WebRTC.requestPermission();   // pre-prompt explainer flows
await WebRTC.getPermissionStatus();
isWebRTCAvailable();                          // false on web / when not linked
```

## Deviations from W3C

- Remote audio tracks render automatically through the platform audio device —
  there is no `<audio>` element. Guard any element-attach code with a platform
  check when sharing a store with web.
- `localDescription` / `remoteDescription` return plain frozen `{ type, sdp }`
  objects with `toJSON()`; there are no `RTCSessionDescription` /
  `RTCIceCandidate` constructors (init dictionaries are accepted everywhere).
- `addTrack` returns a minimal sender — no `replaceTrack` / `getParameters`.
- No `getStats()`, transceivers, video tracks, or renderer views in v1.

## Platform notes

- **Call audio session:** while at least one peer connection is live, the
  module holds the platform in communication mode (Android
  `MODE_IN_COMMUNICATION`) and routes output to the loudspeaker by default;
  the previous state is restored when the last peer closes.
- **Bluetooth headsets:** SCO routing is not wired up yet — calls use the
  built-in speaker or earpiece.
- **`@sigx/lynx-audio` interplay:** avoid starting/stopping its recorders or
  players during an active call; both packages manage the audio session.

License: MIT
