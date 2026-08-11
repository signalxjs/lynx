import { callAsync, isModuleAvailable, unwrapNative } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'ImagePicker';
const PKG = 'lynx-image-picker';

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
 * Native `error` strings that mean "this pick ended without a result", not
 * "the pick broke": the pick was superseded by a newer one, or the host
 * Activity went away underneath it.
 *
 * Android's `MediaCapture` tags both with an `error` string alongside
 * `cancelled: true` (`cancelled by new pickImage` / `pickImages`,
 * `activity destroyed` — `android/…/MediaCapture.kt`), while iOS resolves a
 * plain `{ cancelled: true }`. Recognizing them here is what keeps the two
 * platforms on the same contract; the same sentinel set as `@sigx/lynx-camera`
 * and `@sigx/lynx-file-picker`, which share MediaCapture.
 *
 * A launcher that was never registered is deliberately *not* in the set: it
 * also arrives with `cancelled: true`, but the pick never opened, so it is a
 * failure and must throw.
 */
function isCancelSentinel(error: string): boolean {
    return error.startsWith('cancelled') || error === 'activity destroyed';
}

/**
 * Normalize a raw native result into the JS-side `ImagePickerResult` shape.
 *
 * A dismissal is matched first, before the unwrap: cancellation is not an
 * error channel (C5), and that includes a pick superseded by a newer one or
 * cut short by Activity teardown, which Android reports on the `error` field.
 *
 * Everything else that carries an `error` throws (C4): an unregistered
 * `MediaCapture` launcher, a `launcher.launch` throw, or iOS having no view
 * controller to present from. Without `unwrapNative` those arrived as an
 * ordinary user-cancel and the app silently did nothing.
 *
 * Then defends against two cross-platform asymmetries:
 *  - **Cancelled spelling.** iOS returns `cancelled` (two l's); the older
 *    Android module path historically returned `canceled` (one l). Accept
 *    both and emit the JS-canonical `cancelled`.
 *  - **Missing `assets` on cancel.** Some native paths omit `assets` when
 *    the user cancels. Default to an empty array so callers can always
 *    `.map(...)` without a null-check.
 */
function normalizeAssets(action: string, result: unknown): ImagePickerResult {
    const error = (result as { error?: unknown } | null | undefined)?.error;
    if (typeof error === 'string' && isCancelSentinel(error)) {
        return { cancelled: true, assets: [] };
    }
    const raw = (unwrapNative(PKG, action, result) ?? {}) as Record<string, unknown>;
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
    /**
     * Open the photo picker.
     *
     * The user dismissing the picker resolves `{ cancelled: true, assets: [] }`;
     * a native failure (picker couldn't launch or present) throws a `SigxError`
     * with `code: 'native_error'`.
     */
    async pickImage(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        const r = await callAsync<unknown>(MODULE, 'pickImage', toNativeOptions(options));
        return normalizeAssets('pickImage', r);
    },

    /**
     * Open the video picker. Same cancel/throw split as {@link ImagePicker.pickImage}.
     */
    async pickVideo(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
        const r = await callAsync<unknown>(MODULE, 'pickVideo', { ...toNativeOptions(options), mediaType: 'video' });
        return normalizeAssets('pickVideo', r);
    },

    /**
     * Request photo library permission, showing the OS dialog if needed.
     *
     * A *denied* permission is not a failure — it resolves with
     * `status: 'denied'` / `'blocked'`. Only a native error throws.
     */
    async requestPermission(): Promise<PermissionResponse> {
        return unwrapNative(
            PKG,
            'requestPermission',
            await callAsync<PermissionResponse>(MODULE, 'requestPermission'),
        );
    },

    /** Check current photo library permission status without prompting. */
    async getPermissionStatus(): Promise<PermissionResponse> {
        return unwrapNative(
            PKG,
            'getPermissionStatus',
            await callAsync<PermissionResponse>(MODULE, 'getPermissionStatus'),
        );
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
