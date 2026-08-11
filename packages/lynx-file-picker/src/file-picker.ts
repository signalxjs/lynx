import { callAsync, isModuleAvailable, unwrapNative } from '@sigx/lynx-core';

const MODULE = 'FilePicker';
/** Package short name (no scope), as `unwrapNative`/`SigxError` want it. */
const PKG = 'lynx-file-picker';

export interface FilePickerOptions {
    /** Allow selecting more than one file. Default false. */
    multiple?: boolean;
    /**
     * Filter by MIME types, e.g. `['application/pdf', 'image/*']`.
     * iOS maps these to UTTypes; Android passes them to the SAF
     * `OpenDocument` intent. Omit (or pass an empty array) for any file.
     */
    types?: string[];
    /**
     * Copy the picked file into app storage and return a stable `file://`
     * URI that survives app restarts. Default true (matches the
     * image-picker convention). When false on Android the raw `content://`
     * URI is returned — its read grant is ephemeral and Activity-scoped.
     */
    copyToCache?: boolean;
}

export interface FilePickerAsset {
    /** `file://` URI (copied) or `content://` (Android, `copyToCache: false`). */
    uri: string;
    /** Original file name, e.g. `report.pdf`. */
    name: string;
    /** Resolved MIME type; `application/octet-stream` when unknown. */
    mimeType: string;
    /** File size in bytes; `0` when unknowable. */
    size: number;
}

export interface FilePickerResult {
    cancelled: boolean;
    assets: FilePickerAsset[];
}

/**
 * Normalize a native picker URI so downstream consumers (Lynx's `<image>`
 * loader, `FileSystem`) can use it. iOS returns `file://...` already;
 * defensively add the scheme for bare absolute paths. Android `content://`
 * URIs pass through untouched.
 */
function normalizeUri(uri: string): string {
    if (uri.startsWith('/')) return `file://${uri}`;
    return uri;
}

/** Last path segment of a URI, percent-decoded — fallback for `name`. */
function nameFromUri(uri: string): string {
    const seg = uri.split('/').filter(Boolean).pop() ?? 'file';
    try {
        return decodeURIComponent(seg);
    } catch {
        return seg;
    }
}

/**
 * Normalize a raw native result into the JS-side `FilePickerResult` shape.
 *
 * Mirrors the image-picker defenses (accept both `cancelled`/`canceled`
 * spellings, default `assets` to an empty array) and additionally
 * guarantees the asset contract: `name`, `mimeType` and `size` are always
 * present — `@sigx/lynx-http`'s `FormData` consumes picked assets as file
 * handles and relies on these fields.
 */
function normalizeResult(result: unknown): FilePickerResult {
    const raw = (result ?? {}) as Record<string, unknown>;
    const cancelled = Boolean(raw['cancelled'] ?? raw['canceled'] ?? false);
    const assetsIn = Array.isArray(raw['assets'])
        ? (raw['assets'] as Array<Record<string, unknown>>)
        : [];
    const assets: FilePickerAsset[] = [];
    for (const a of assetsIn) {
        const rawUri = typeof a['uri'] === 'string' ? a['uri'] : '';
        if (!rawUri) continue; // an asset without a URI is unusable — drop it
        const uri = normalizeUri(rawUri);
        assets.push({
            uri,
            name: typeof a['name'] === 'string' && a['name'] ? a['name'] : nameFromUri(uri),
            mimeType: typeof a['mimeType'] === 'string' && a['mimeType']
                ? a['mimeType']
                : 'application/octet-stream',
            size: typeof a['size'] === 'number' && Number.isFinite(a['size']) && a['size'] >= 0
                ? a['size']
                : 0,
        });
    }
    return { cancelled, assets };
}

/**
 * Native `error` strings that mean "this pick ended without a result", not
 * "the pick broke" — the pick was superseded by a newer one, or the host
 * Activity went away underneath it.
 *
 * The platforms disagree on how they signal these, which is exactly why the
 * check lives here: iOS pre-empts an in-flight pick with a plain
 * `{ cancelled: true, assets: [] }` (`ios/FilePickerModule.swift`), while
 * Android tags the same event `"cancelled by new pickFile"` / `"…pickFiles"`
 * and Activity teardown `"activity destroyed"` (`MediaCapture.kt`). Without
 * this, an ordinary superseded pick would throw on Android and resolve on
 * iOS. Same sentinel set as `@sigx/lynx-camera`, which shares MediaCapture.
 */
function isCancelSentinel(error: string): boolean {
    return error.startsWith('cancelled') || error === 'activity destroyed';
}

/** True when native reported a dismissal rather than a failure (C5). */
function isDismissal(raw: unknown): boolean {
    const error = (raw as { error?: unknown } | null | undefined)?.error;
    return typeof error === 'string' && isCancelSentinel(error);
}

/**
 * Pass a recognizable payload through; turn anything else into an `{ error }`
 * envelope so `unwrapNative` rejects it.
 *
 * `unwrapNative` only knows about `{ error }` — a string, an array or `null`
 * would sail past it and `normalizeResult` would report it as a successful
 * pick of zero files, which is a lie the caller can't detect. The bridge's
 * payload shape genuinely varies by path (#342), so this is a live case, not
 * a hypothetical. Same guard as `@sigx/lynx-camera`'s `settleCapture`.
 */
function asDocumentedPayload(raw: unknown): unknown {
    const r = raw as Record<string, unknown> | null | undefined;
    const recognized =
        r != null &&
        typeof r === 'object' &&
        ('assets' in r || 'cancelled' in r || 'canceled' in r || r['error'] != null);
    return recognized ? raw : { error: `unexpected native payload: ${JSON.stringify(raw)}` };
}

/** Translate JS options into the shape the native modules consume. */
function toNativeOptions(options: FilePickerOptions): Record<string, unknown> {
    return {
        multiple: options.multiple === true,
        types: Array.isArray(options.types) ? options.types.filter((t) => typeof t === 'string' && t.length > 0) : [],
        copyToCache: options.copyToCache !== false,
    };
}

/**
 * Generic file picker — pick any file from the device (Files app / SAF).
 *
 * This is the picker for *arbitrary* files (`UIDocumentPickerViewController`
 * on iOS, Storage Access Framework `OpenDocument` on Android). For the
 * photo-library grid UX use `@sigx/lynx-image-picker` instead — the OS
 * ships two distinct picker UIs and so do we.
 *
 * Like the system photo picker, both platform pickers grant per-pick
 * access on the fly — no permission request is needed (or offered).
 *
 * @example
 * ```ts
 * import { FilePicker } from '@sigx/lynx-file-picker';
 *
 * const result = await FilePicker.pick({ types: ['application/pdf'], multiple: true });
 * if (!result.cancelled) {
 *     for (const f of result.assets) {
 *         console.log(f.name, f.mimeType, f.size, f.uri);
 *     }
 * }
 * ```
 */
export const FilePicker = {
    /**
     * Open the system document picker.
     *
     * A user dismissing the picker resolves `{ cancelled: true, assets: [] }` —
     * cancellation is not an error channel (C5), and neither is a pick
     * superseded by a newer one or cut short by Activity teardown.
     *
     * @throws a `SigxError` (`code: 'native_error'`) when the picker itself
     * failed to open — the Android launcher isn't registered
     * (`@sigx/lynx-permissions` missing from the build), the intent can't be
     * launched, or iOS has no view controller to present from. These arrive on
     * the *resolved* bridge callback as `{ error }` (C4), so before this they
     * were indistinguishable from a cancel: the picker never opened and
     * `pick()` reported a dismiss.
     */
    async pick(options: FilePickerOptions = {}): Promise<FilePickerResult> {
        const raw = await callAsync<unknown>(MODULE, 'pick', toNativeOptions(options));
        if (isDismissal(raw)) return { cancelled: true, assets: [] };
        return normalizeResult(unwrapNative(PKG, 'pick', asDocumentedPayload(raw)));
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
