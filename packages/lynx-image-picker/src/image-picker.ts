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
/**
 * Normalize a native picker URI so Lynx's `<image>` element can load it.
 * iOS returns a bare absolute filesystem path (e.g.
 * `/var/.../tmp/pick_xxx.jpg`); Lynx's image loader expects a scheme
 * (`file://...`). Android returns `content://...` URIs which already
 * carry a scheme and pass through untouched.
 */
function normalizeUri(uri: string): string {
    if (uri.startsWith('/')) return `file://${uri}`;
    return uri;
}

function normalizeAssets(result: ImagePickerResult): ImagePickerResult {
    return {
        cancelled: result.cancelled,
        assets: result.assets.map((a) => ({ ...a, uri: normalizeUri(a.uri) })),
    };
}

export const ImagePicker = {
    async pickImage(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        const r = await callAsync<ImagePickerResult>(MODULE, 'pickImage', options);
        return normalizeAssets(r);
    },

    async pickVideo(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        const r = await callAsync<ImagePickerResult>(MODULE, 'pickVideo', { ...options, mediaType: 'video' });
        return normalizeAssets(r);
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
