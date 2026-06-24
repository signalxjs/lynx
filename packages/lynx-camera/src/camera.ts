import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'Camera';

export interface CameraOptions {
    /** 'front' or 'back' camera */
    facing?: 'front' | 'back';
    /** Image quality 0-1 */
    quality?: number;
    /** Max width in pixels */
    maxWidth?: number;
    /** Max height in pixels */
    maxHeight?: number;
}

export interface PhotoResult {
    /** File URI of the captured photo */
    uri: string;
    /** Width in pixels */
    width: number;
    /** Height in pixels */
    height: number;
    /** Base64-encoded image data (if requested) */
    base64?: string;
}

export interface CameraVideoOptions {
    /** 'front' or 'back' camera */
    facing?: 'front' | 'back';
    /**
     * Max recording length in milliseconds. Honored on iOS
     * (`videoMaximumDuration`); ignored on Android, whose
     * `ACTION_VIDEO_CAPTURE` contract exposes no duration cap.
     */
    maxDurationMs?: number;
}

export interface VideoResult {
    /** File URI of the recorded clip (`file://` on iOS, `content://` on Android) */
    uri: string;
    /** Clip duration in milliseconds (if the platform reports it) */
    durationMs?: number;
    /** Width in pixels (if the platform reports it) */
    width?: number;
    /** Height in pixels (if the platform reports it) */
    height?: number;
    /** File size in bytes (if the platform reports it) */
    fileSize?: number;
}

/**
 * Resolved when the user dismisses the camera without capturing. `uri` is
 * typed as `undefined` so callers can narrow on `result.uri` to distinguish a
 * successful capture from a cancel.
 */
export interface CameraCancelled {
    cancelled: true;
    uri?: undefined;
}

/**
 * Normalize a native capture URI so Lynx elements can load it. iOS returns a
 * bare absolute filesystem path (e.g. `/var/.../tmp/camera_xxx.mov`); Lynx's
 * loaders expect a scheme (`file://...`). Android returns `content://...` URIs
 * (FileProvider) which already carry a scheme and pass through untouched.
 *
 * Mirrors `normalizeUri` in `@sigx/lynx-image-picker`.
 */
function normalizeUri(uri: string): string {
    if (uri.startsWith('/')) return `file://${uri}`;
    return uri;
}

/**
 * Camera capture APIs.
 *
 * @example
 * ```ts
 * import { Camera } from '@sigx/lynx-camera';
 *
 * const { status } = await Camera.requestPermission();
 * if (status === 'granted') {
 *     const photo = await Camera.takePicture({ quality: 0.8 });
 *     if (photo.uri) console.log(photo.uri);
 *
 *     const clip = await Camera.recordVideo({ maxDurationMs: 30_000 });
 *     if (clip.uri) console.log(clip.uri);
 * }
 * ```
 */
export const Camera = {
    /**
     * Open the system camera in photo mode. Resolves with the captured photo
     * (its `uri` is loadable by Lynx's `<image>`), or `{ cancelled: true }`
     * (no `uri`) if the user dismisses the camera — narrow on `result.uri`.
     */
    async takePicture(options: CameraOptions = {}): Promise<PhotoResult | CameraCancelled> {
        const r = await callAsync<PhotoResult | CameraCancelled>(MODULE, 'takePicture', options);
        // iOS returns a bare temp path; normalize to a `file://` URI so `<image>`
        // can load it (Android already returns a scheme'd `content://` URI).
        return r && typeof r.uri === 'string' ? { ...r, uri: normalizeUri(r.uri) } : r;
    },

    /**
     * Open the system camera in video mode and record a clip. Resolves with the
     * recorded clip (its `uri` is loadable by `@sigx/lynx-video`'s
     * `VideoPlayer`), or `{ cancelled: true }` (no `uri`) on cancel — narrow on
     * `result.uri`.
     */
    async recordVideo(options: CameraVideoOptions = {}): Promise<VideoResult | CameraCancelled> {
        const r = await callAsync<VideoResult | CameraCancelled>(MODULE, 'recordVideo', options);
        // On cancel the native side returns `{ cancelled: true }` with no `uri`;
        // leave that shape untouched.
        return r && typeof r.uri === 'string' ? { ...r, uri: normalizeUri(r.uri) } : r;
    },

    /** Request camera permission, showing the OS dialog if needed. */
    requestPermission(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'requestPermission');
    },

    /** Check current camera permission status without prompting. */
    getPermissionStatus(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'getPermissionStatus');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
