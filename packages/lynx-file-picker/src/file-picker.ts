import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'FilePicker';

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
    async pick(options: FilePickerOptions = {}): Promise<FilePickerResult> {
        const r = await callAsync<unknown>(MODULE, 'pick', toNativeOptions(options));
        return normalizeResult(r);
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
