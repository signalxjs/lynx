import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'Camera';

export interface CameraOptions {
    /**
     * 'front' or 'back' camera. **iOS only** — Android's system-camera intent
     * ignores capture options; the user can still switch cameras in its UI.
     */
    facing?: 'front' | 'back';
    /** JPEG quality 0-1 (default 0.8). **iOS only** — Android's intent ignores it. */
    quality?: number;
    /** Max width in pixels. **Reserved — not yet applied on either platform.** */
    maxWidth?: number;
    /** Max height in pixels. **Reserved — not yet applied on either platform.** */
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
    /**
     * 'front' or 'back' camera. **iOS only** — Android's `ACTION_VIDEO_CAPTURE`
     * intent ignores options; the user can still switch cameras in its UI.
     */
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
 * Settle a raw native capture payload into the public three-outcome contract:
 *
 *  - **success** — a `{ uri, ... }` result, with the URI normalized to a scheme
 *    Lynx can load (iOS hands back a bare path; Android a `content://` URI).
 *  - **cancel** — the documented `{ cancelled: true }` shape. Android flags
 *    user-cancel and re-entrant pre-emption with `cancelled`-prefixed sentinels
 *    (`"cancelled"`, `"cancelled by new takePicture"`, …); we collapse those so
 *    callers never special-case them per platform.
 *  - **failure** — throws. Genuine native errors (permission denied, camera
 *    unavailable, FileProvider misconfigured) arrive as `{ error }` on the
 *    resolved callback rather than a rejection; rethrow so callers can
 *    `try/catch` instead of inspecting an untyped error field.
 */
function settleCapture<T extends { uri: string }>(raw: unknown): T | CameraCancelled {
    const r = (raw ?? {}) as { uri?: unknown; error?: unknown };
    if (typeof r.uri === 'string') {
        return { ...(r as T), uri: normalizeUri(r.uri) };
    }
    // Cancel/pre-emption sentinels all start with "cancelled"; any other error
    // string is a genuine failure. Real failures never use that prefix.
    if (typeof r.error === 'string' && !r.error.startsWith('cancelled')) {
        throw new Error(r.error);
    }
    return { cancelled: true };
}

/**
 * Camera capture APIs.
 *
 * Each capture has three outcomes: it resolves with a result (always carrying a
 * `uri`), resolves with `{ cancelled: true }` if the user dismisses the camera,
 * or **throws** on failure (permission denied, no camera, …).
 *
 * @example
 * ```ts
 * import { Camera } from '@sigx/lynx-camera';
 *
 * try {
 *     const photo = await Camera.takePicture({ quality: 0.8 });
 *     if (photo.uri) console.log(photo.uri);  // else: user cancelled
 *
 *     const clip = await Camera.recordVideo({ maxDurationMs: 30_000 });
 *     if (clip.uri) console.log(clip.uri);
 * } catch (e) {
 *     console.warn('capture failed:', e);
 * }
 * ```
 */
export const Camera = {
    /**
     * Open the system camera in photo mode. Resolves with the captured photo
     * (its `uri` is loadable by Lynx's `<image>`) or `{ cancelled: true }` if
     * the user dismisses the camera; throws on failure. Narrow on `result.uri`.
     */
    async takePicture(options: CameraOptions = {}): Promise<PhotoResult | CameraCancelled> {
        return settleCapture<PhotoResult>(await callAsync<unknown>(MODULE, 'takePicture', options));
    },

    /**
     * Open the system camera in video mode and record a clip. Resolves with the
     * recorded clip (its `uri` is loadable by `@sigx/lynx-video`'s
     * `VideoPlayer`) or `{ cancelled: true }` if the user dismisses the camera;
     * throws on failure. Narrow on `result.uri`.
     */
    async recordVideo(options: CameraVideoOptions = {}): Promise<VideoResult | CameraCancelled> {
        return settleCapture<VideoResult>(await callAsync<unknown>(MODULE, 'recordVideo', options));
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
