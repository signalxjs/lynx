/**
 * `MediaStream` / `MediaStreamTrack` / `mediaDevices.getUserMedia` — the
 * media-capture subset backed by the native WebRTC module.
 *
 * v1 is audio-only: `getUserMedia({ video: true })` rejects with
 * `NotSupportedError`. A denied microphone prompt rejects with
 * `NotAllowedError`, exactly like browsers, so ported code needs no
 * change.
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
import type { MediaStreamTrackState } from './types.js';

export interface MediaTrackConstraintSet {
    /** Accepted for API compatibility; the native capturer uses platform defaults in v1. */
    [key: string]: unknown;
}

export interface MediaStreamConstraints {
    audio?: boolean | MediaTrackConstraintSet;
    video?: boolean | MediaTrackConstraintSet;
}

/**
 * An audio track captured from the microphone (local) or received from a
 * peer (remote). Remote audio tracks render automatically through the
 * device's audio output — there is no element to attach.
 */
export class MediaStreamTrack extends RTCEventTargetBase {
    readonly kind: 'audio' | 'video';
    /** W3C string id (the stringified native handle). */
    readonly id: string;
    readonly label: string;
    /** True for tracks received from a peer. */
    readonly remote: boolean;

    onended: ((ev: RTCEventLike) => void) | null = null;
    onmute: ((ev: RTCEventLike) => void) | null = null;
    onunmute: ((ev: RTCEventLike) => void) | null = null;

    /** @internal native registry handle (positive = local, negative = remote). */
    readonly _handle: number;
    private _enabled = true;
    private _readyState: MediaStreamTrackState = 'live';
    private _muted: boolean;

    /** @internal — use `mediaDevices.getUserMedia()`; remote tracks come from `ontrack`. */
    constructor(handle: number, kind: 'audio' | 'video', label: string, opts: { remote: boolean; muted?: boolean }) {
        super();
        this._handle = handle;
        this.kind = kind;
        this.id = String(handle);
        this.label = label;
        this.remote = opts.remote;
        this._muted = opts.muted ?? false;
        registerDispatcher(handle, evt => this._dispatch(evt));
    }

    get readyState(): MediaStreamTrackState {
        return this._readyState;
    }

    /** Whether the remote side is currently sending media on this track. */
    get muted(): boolean {
        return this._muted;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    /** Setting `enabled = false` mutes the track (silence/black) without stopping capture. */
    set enabled(value: boolean) {
        const v = Boolean(value);
        if (v === this._enabled) return;
        const prev = this._enabled;
        this._enabled = v;
        callAsync(MODULE, 'setTrackEnabled', this._handle, v)
            .then(unwrap)
            .catch(err => {
                // Keep the JS flag in sync with native (unless it changed again).
                if (this._enabled === v) this._enabled = prev;
                console.warn('[WebRTC] setTrackEnabled failed:', err);
            });
    }

    /** Permanently end the track and release the capturer. Does not fire `ended` (per W3C). */
    stop(): void {
        if (this._readyState === 'ended') return;
        this._readyState = 'ended';
        unregisterDispatcher(this._handle);
        callAsync(MODULE, 'stopTrack', this._handle)
            .then(unwrap)
            .catch(err => {
                console.warn('[WebRTC] stopTrack failed:', err);
            });
    }

    /** @internal — mark ended without a native round-trip (peer close, native event). */
    _endLocally(fireEvent: boolean): void {
        if (this._readyState === 'ended') return;
        this._readyState = 'ended';
        unregisterDispatcher(this._handle);
        if (fireEvent) {
            this._emit('ended', { type: 'ended', target: this, currentTarget: this });
        }
    }

    private _dispatch(evt: NativeEvent): void {
        switch (evt.type) {
            case 'trackended':
                this._endLocally(true);
                break;
            case 'trackmuted':
                if (this._muted) return;
                this._muted = true;
                this._emit('mute', { type: 'mute', target: this, currentTarget: this });
                break;
            case 'trackunmuted':
                if (!this._muted) return;
                this._muted = false;
                this._emit('unmute', { type: 'unmute', target: this, currentTarget: this });
                break;
        }
    }
}

/**
 * A grouping of tracks. On this runtime the stream itself is JS-side
 * bookkeeping — tracks carry the native handles; the stream's string `id`
 * is what appears as the msid in SDP.
 */
export class MediaStream {
    readonly id: string;
    private readonly _tracks: MediaStreamTrack[] = [];

    constructor(tracksOrId?: MediaStreamTrack[] | string) {
        if (typeof tracksOrId === 'string') {
            this.id = tracksOrId;
        } else {
            this.id = `stream-${allocId()}`;
            if (tracksOrId) this._tracks.push(...tracksOrId);
        }
    }

    getTracks(): MediaStreamTrack[] {
        return [...this._tracks];
    }

    getAudioTracks(): MediaStreamTrack[] {
        return this._tracks.filter(t => t.kind === 'audio');
    }

    getVideoTracks(): MediaStreamTrack[] {
        return this._tracks.filter(t => t.kind === 'video');
    }

    addTrack(track: MediaStreamTrack): void {
        if (!this._tracks.includes(track)) this._tracks.push(track);
    }

    removeTrack(track: MediaStreamTrack): void {
        const i = this._tracks.indexOf(track);
        if (i >= 0) this._tracks.splice(i, 1);
    }
}

export const mediaDevices = {
    /**
     * Capture the microphone. Triggers the OS permission prompt when the
     * permission is undetermined; rejects with `NotAllowedError` on denial.
     *
     * @example
     * ```ts
     * const stream = await mediaDevices.getUserMedia({ audio: true });
     * peer.addTrack(stream.getAudioTracks()[0], stream);
     * ```
     */
    async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
        guardModule(MODULE);
        ensureSubscribed();
        if (!constraints || (!constraints.audio && !constraints.video)) {
            throw new TypeError('getUserMedia: at least one of audio or video must be requested');
        }
        if (constraints.video) {
            const e = new Error('getUserMedia: video capture is not supported yet');
            e.name = 'NotSupportedError';
            throw e;
        }

        const trackId = allocId();
        const result = unwrap<{ label?: string } | undefined>(
            await callAsync(MODULE, 'getUserMedia', trackId, {
                audio: true,
            }),
        );

        const track = new MediaStreamTrack(trackId, 'audio', result?.label ?? 'microphone', {
            remote: false,
        });
        return new MediaStream([track]);
    },
} as const;
