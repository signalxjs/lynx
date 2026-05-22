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
 * The system photo pickers used here (Android `PickVisualMedia`, iOS
 * `PHPicker`) grant per-pick access on the fly — **callers do not need
 * to call `requestPermission` before `pickImage`**. Doing so on
 * Android 14+ surfaces a second bottom sheet (the `READ_MEDIA_IMAGES`
 * partial-access prompt) before the picker itself.
 *
 * Only call `requestPermission` when you intend to read the gallery
 * directly outside the picker.
 *
 * @example
 * ```ts
 * import { ImagePicker } from '@sigx/lynx-image-picker';
 *
 * const result = await ImagePicker.pickImage({ multiple: true, maxItems: 10 });
 * if (!result.cancelled) {
 *     console.log(result.assets.map((a) => a.uri));
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

/**
 * Normalize a raw native result into the JS-side `ImagePickerResult` shape.
 *
 * Defends against two cross-platform asymmetries:
 *  - **Cancelled spelling.** iOS returns `cancelled` (two l's); the older
 *    Android module path historically returned `canceled` (one l). Accept
 *    both and emit the JS-canonical `cancelled`.
 *  - **Missing `assets` on cancel.** Some native paths omit `assets` when
 *    the user cancels. Default to an empty array so callers can always
 *    `.map(...)` without a null-check.
 */
function normalizeAssets(result: unknown): ImagePickerResult {
    const raw = (result ?? {}) as Record<string, unknown>;
    const cancelled = Boolean(raw['cancelled'] ?? raw['canceled'] ?? false);
    const assetsIn = Array.isArray(raw['assets']) ? raw['assets'] as ImagePickerAsset[] : [];
    return {
        cancelled,
        assets: assetsIn.map((a) => ({ ...a, uri: normalizeUri(a.uri) })),
    };
}

/**
 * Translate the JS-side `multiple` / `maxItems` ergonomics into the
 * `selectionLimit` shape that the iOS PHPicker bridge (and the matching
 * Android `PickMultipleVisualMedia` branch) consumes:
 *
 *   - `multiple: false` (or omitted)  → selectionLimit = 1
 *   - `multiple: true`, no maxItems  → selectionLimit = 0 (= "unlimited" on iOS)
 *   - `multiple: true`, maxItems = N → selectionLimit = N
 *
 * Other keys (`quality`, `mediaType`) pass through untouched.
 */
function toNativeOptions(options: ImagePickerOptions): Record<string, unknown> {
    const out: Record<string, unknown> = { ...options };
    if (options.multiple) {
        out.selectionLimit = options.maxItems && options.maxItems > 0 ? options.maxItems : 0;
    } else {
        out.selectionLimit = 1;
    }
    return out;
}

export const ImagePicker = {
    async pickImage(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        const r = await callAsync<unknown>(MODULE, 'pickImage', toNativeOptions(options));
        return normalizeAssets(r);
    },

    async pickVideo(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        const r = await callAsync<unknown>(MODULE, 'pickVideo', { ...toNativeOptions(options), mediaType: 'video' });
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
