import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'ImagePicker';

export interface ImagePickerOptions {
    /** 'photo', 'video', or 'mixed' */
    mediaType?: 'photo' | 'video' | 'mixed';
    /** Allow multiple selection */
    multiple?: boolean;
    /** Max number of items (if multiple) */
    maxItems?: number;
    /** Image quality 0-1 */
    quality?: number;
}

export interface ImagePickerResult {
    cancelled: boolean;
    assets: ImagePickerAsset[];
}

export interface ImagePickerAsset {
    uri: string;
    width: number;
    height: number;
    type: 'image' | 'video';
    fileSize?: number;
    fileName?: string;
}

/**
 * Image/video picker APIs.
 *
 * @example
 * ```ts
 * import { ImagePicker } from '@sigx/lynx-image-picker';
 *
 * const { status } = await ImagePicker.requestPermission();
 * if (status === 'granted') {
 *     const result = await ImagePicker.pickImage({ quality: 0.8 });
 *     if (!result.cancelled) {
 *         console.log(result.assets[0].uri);
 *     }
 * }
 * ```
 */
export const ImagePicker = {
    pickImage(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        return callAsync<ImagePickerResult>(MODULE, 'pickImage', options);
    },

    pickVideo(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        return callAsync<ImagePickerResult>(MODULE, 'pickVideo', { ...options, mediaType: 'video' });
    },

    /** Request photo library permission, showing the OS dialog if needed. */
    requestPermission(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'requestPermission');
    },

    /** Check current photo library permission status without prompting. */
    getPermissionStatus(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'getPermissionStatus');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
