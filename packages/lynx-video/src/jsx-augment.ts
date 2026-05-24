/**
 * JSX intrinsic type augmentation for `<video-player>`.
 *
 * Importing this module registers `'video-player'` as a valid JSX intrinsic
 * with the prop + event surface implemented by `VideoPlayerUI` (iOS) and
 * `VideoPlayerUI.kt` (Android). Pulled in automatically by
 * `@sigx/lynx-video`'s entry point so consumers do not need to import it
 * directly.
 *
 * Element availability requires `sigx prebuild` to have run after adding
 * this package as a dependency — the autolinker emits the `LynxConfig`
 * registration (iOS) and `Behavior` attachment (Android) that bind the tag
 * to the native UI class.
 */
import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';

export interface VideoLoadEventDetail {
    /** Total duration in milliseconds. 0 if unknown (live streams). */
    durationMs: number;
    /** Natural width in pixels. */
    width: number;
    /** Natural height in pixels. */
    height: number;
    [k: string]: unknown;
}
export interface VideoLoadEvent {
    type: 'load';
    detail: VideoLoadEventDetail;
}

export interface VideoEndEventDetail {
    [k: string]: unknown;
}
export interface VideoEndEvent {
    type: 'end';
    detail: VideoEndEventDetail;
}

export interface VideoErrorEventDetail {
    message: string;
    [k: string]: unknown;
}
export interface VideoErrorEvent {
    type: 'error';
    detail: VideoErrorEventDetail;
}

export interface VideoTimeUpdateEventDetail {
    /** Current playback position in milliseconds. */
    positionMs: number;
    [k: string]: unknown;
}
export interface VideoTimeUpdateEvent {
    type: 'timeupdate';
    detail: VideoTimeUpdateEventDetail;
}

export type VideoResizeMode = 'contain' | 'cover' | 'stretch';

export interface VideoPlayerAttributes extends LynxCommonAttributes {
    /** URL or `file://` URI of the asset to play. */
    src?: string;
    /** Image displayed before the first frame is decoded. */
    poster?: string;
    /** Begin playback as soon as the asset is ready. Default: false. */
    autoplay?: boolean;
    /**
     * Drive play/pause declaratively. `true` resumes, `false` pauses. Apps
     * that prefer imperative control can flip a signal that drives this prop.
     */
    playing?: boolean;
    /** Restart automatically at end-of-clip. Default: false. */
    loop?: boolean;
    /** Mute audio output, independent of `volume`. Default: false. */
    muted?: boolean;
    /** Output volume 0..1. Default: 1. */
    volume?: number;
    /** Show platform-default playback controls overlay. Default: false. */
    controls?: boolean;
    /** How the video frame fits inside the element box. Default: `'contain'`. */
    'resize-mode'?: VideoResizeMode;

    /** Fires once asset metadata is available (duration, dimensions). */
    bindload?: LynxEventHandler<VideoLoadEvent>;
    /** Fires when playback reaches the end of the clip (not when looping). */
    bindend?: LynxEventHandler<VideoEndEvent>;
    /** Fires on a non-recoverable load or playback error. */
    binderror?: LynxEventHandler<VideoErrorEvent>;
    /**
     * Fires ~4×/sec while playing with the current position. Use sparingly —
     * this crosses the bridge per call. For high-frequency animations,
     * subscribe to the asset duration once and animate locally instead.
     */
    bindtimeupdate?: LynxEventHandler<VideoTimeUpdateEvent>;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'video-player': VideoPlayerAttributes;
        }
    }
}

export {};
