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
 *     console.log(photo.uri);
 * }
 * ```
 */
export const Camera = {
    takePicture(options: CameraOptions = {}): Promise<PhotoResult> {
        return callAsync<PhotoResult>(MODULE, 'takePicture', options);
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
