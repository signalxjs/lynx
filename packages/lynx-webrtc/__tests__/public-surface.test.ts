/**
 * Public-surface freeze test for @sigx/lynx-webrtc.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The many
 *    type-only exports (`RTCConfiguration`, `RTCSessionDescriptionInit`, the
 *    state unions, the re-exported `PermissionResponse`, …) are erased at
 *    runtime and are pinned below instead.
 *  - Types: the load-bearing signatures. This package is deliberately shaped
 *    like the browser API, so the W3C names double as the contract — code
 *    ported from the web breaks the moment one of them drifts. On top of that
 *    sit the repo conventions: `isAvailable` stays synchronous (C2) and the
 *    permission methods resolve a `PermissionResponse` (C6).
 *
 * Note: this package has no `.web.ts` sibling — WebRTC on web is the
 * browser's own implementation, not a shim — so there is no web-parity block
 * (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PermissionResponse as CorePermissionResponse } from '@sigx/lynx-core';

import * as webrtc from '../src/index';
import {
    MediaStream,
    MediaStreamTrack,
    RTCDataChannel,
    RTCPeerConnection,
    WebRTC,
    isWebRTCAvailable,
    mediaDevices,
} from '../src/index';
import type {
    AudioOutputRoute,
    MediaStreamConstraints,
    PermissionResponse,
    RTCDataChannelInit,
    RTCIceCandidateInit,
    RTCOfferOptions,
    RTCSessionDescriptionInit,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(webrtc).sort()).toEqual(
            [
                // W3C-shaped core — these names are the port contract
                'RTCPeerConnection',
                'RTCDataChannel',
                'MediaStream',
                'MediaStreamTrack',
                'mediaDevices',
                // Non-W3C extras: audio routing + repo-idiomatic permissions
                'WebRTC',
                'isWebRTCAvailable',
            ].sort(),
        );
    });

    it('exposes exactly the documented WebRTC namespace methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(WebRTC).sort()).toEqual([
            'getPermissionStatus',
            'isAvailable',
            'requestPermission',
            'setAudioOutput',
        ]);
    });

    it('keeps mediaDevices minimal', () => {
        // Anything beyond getUserMedia here is a browser API we are claiming
        // to implement; adding one is a surface decision, not a detail.
        expect(Object.keys(mediaDevices).sort()).toEqual(['getUserMedia']);
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(WebRTC.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(WebRTC.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
        // Frozen as-is, not endorsed: the same check also ships as a bare
        // root export under a second name. Collapsing the two is a deliberate
        // surface change — delete this line with it.
        expectTypeOf(isWebRTCAvailable).toEqualTypeOf<() => boolean>();
    });

    it('re-exports PermissionResponse from the barrel, unaliased (C6)', () => {
        // The barrel must be self-sufficient: typing permission state must not
        // force a second import from `@sigx/lynx-core`. Both halves matter —
        // that the name is exported at all, and that it is still *core's*
        // type rather than a structural copy that can drift (the mistake
        // `@sigx/lynx-web-host` made with `HostPermissionResponse`).
        expectTypeOf<PermissionResponse>().toEqualTypeOf<CorePermissionResponse>();
        expectTypeOf<PermissionResponse>().toEqualTypeOf<{
            status: 'granted' | 'denied' | 'undetermined' | 'blocked';
            canAskAgain: boolean;
        }>();
    });

    it('pins the permission methods to the shared envelope (C6)', () => {
        // Consumers branch on `.status` / `.canAskAgain` to decide whether a
        // pre-prompt explainer is worth showing; a bespoke return shape here
        // would break every caller that treats permissions uniformly.
        expectTypeOf(WebRTC.requestPermission).toEqualTypeOf<() => Promise<PermissionResponse>>();
        expectTypeOf(WebRTC.getPermissionStatus).toEqualTypeOf<() => Promise<PermissionResponse>>();
        expectTypeOf(WebRTC.setAudioOutput).toEqualTypeOf<
            (route: AudioOutputRoute) => Promise<void>
        >();
        expectTypeOf<AudioOutputRoute>().toEqualTypeOf<'speaker' | 'earpiece'>();
    });

    it('pins the capture entry point', () => {
        // getUserMedia is the first call in every ported snippet; its
        // constraints argument and MediaStream result are what make that
        // code compile unchanged.
        expectTypeOf(mediaDevices.getUserMedia).toEqualTypeOf<
            (constraints: MediaStreamConstraints) => Promise<MediaStream>
        >();
    });

    it('pins the signalling handshake', () => {
        // The offer/answer round trip is the part a consumer wires to their
        // own transport; a changed argument or resolved shape here means
        // hand-written SDP plumbing stops type-checking on upgrade.
        expectTypeOf<RTCPeerConnection['createOffer']>().toEqualTypeOf<
            (options?: RTCOfferOptions) => Promise<RTCSessionDescriptionInit>
        >();
        expectTypeOf<RTCPeerConnection['createAnswer']>().toEqualTypeOf<
            () => Promise<RTCSessionDescriptionInit>
        >();
        expectTypeOf<RTCPeerConnection['setLocalDescription']>().toEqualTypeOf<
            (description?: RTCSessionDescriptionInit) => Promise<void>
        >();
        expectTypeOf<RTCPeerConnection['setRemoteDescription']>().toEqualTypeOf<
            (description: RTCSessionDescriptionInit) => Promise<void>
        >();
        expectTypeOf<RTCPeerConnection['addIceCandidate']>().toEqualTypeOf<
            (candidate?: RTCIceCandidateInit | null) => Promise<void>
        >();
        expectTypeOf<RTCPeerConnection['createDataChannel']>().toEqualTypeOf<
            (label: string, init?: RTCDataChannelInit) => RTCDataChannel
        >();
    });

    it('freezes the event subscription as void, not an unsubscribe (C7)', () => {
        // Frozen as-is, not endorsed: repo convention is that subscribing
        // returns a `() => void` teardown, but the W3C EventTarget shape wins
        // here so ported code keeps working. Callers unsubscribe with
        // removeEventListener; if that ever changes, both the README and
        // every consumer's cleanup path change with it.
        expectTypeOf<RTCPeerConnection['addEventListener']>().returns.toBeVoid();
        expectTypeOf<RTCPeerConnection['removeEventListener']>().returns.toBeVoid();
        expectTypeOf<RTCDataChannel['send']>().toEqualTypeOf<
            (data: string | ArrayBuffer | ArrayBufferView) => void
        >();
    });

    it('pins the track lifecycle reads', () => {
        // `enabled` is a settable mutable property (mute/unmute), while
        // readyState and muted are getters driven by native events — the
        // asymmetry is the API, and flipping one would silently no-op.
        expectTypeOf<MediaStreamTrack['readyState']>().toEqualTypeOf<'live' | 'ended'>();
        expectTypeOf<MediaStreamTrack['muted']>().toBeBoolean();
        expectTypeOf<MediaStream['getAudioTracks']>().toEqualTypeOf<() => MediaStreamTrack[]>();
    });
});
