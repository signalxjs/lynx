/**
 * WHATWG-shaped `FormData` for multipart uploads.
 *
 * Values are strings or **file handles** — plain objects carrying a `uri`.
 * Two handle shapes are accepted:
 *
 *   - `@sigx/lynx-file-picker` / `lynx-image-picker` assets:
 *     `{ uri, name?, mimeType?, size? }`
 *   - the React Native convention: `{ uri, name?, type? }`
 *
 * THE CORE INVARIANT: file bytes never cross the JS bridge. A file value
 * serializes to a `{ kind: 'file', uri, ... }` descriptor and the native
 * side streams the bytes from the URI straight into the multipart body
 * (URLSession upload task on iOS, OkHttp RequestBody on Android).
 */
import type { NativeBody, NativeMultipartPart } from './types.js';

export interface FileHandleLike {
    /** `file://` or (Android) `content://` URI of the file to upload. */
    uri: string;
    /** File name for the `Content-Disposition` filename. */
    name?: string;
    /** MIME type — picker-asset spelling. */
    mimeType?: string;
    /** MIME type — React Native convention spelling. */
    type?: string;
    /** Size in bytes (informational; not sent on the wire). */
    size?: number;
}

export type FormDataEntryValueLike = string | FileHandleLike;

export function isFileHandle(value: unknown): value is FileHandleLike {
    return typeof value === 'object'
        && value !== null
        && typeof (value as FileHandleLike).uri === 'string'
        && (value as FileHandleLike).uri.length > 0;
}

interface Entry {
    name: string;
    value: FormDataEntryValueLike;
    filename?: string;
}

function assertValidValue(method: string, value: unknown): void {
    if (typeof value !== 'string' && !isFileHandle(value)) {
        throw new TypeError(
            `FormData.${method}: value must be a string or a file handle with a \`uri\` ` +
            '(e.g. a FilePicker/ImagePicker asset or { uri, name, type })',
        );
    }
}

export class FormData {
    private entries_: Entry[] = [];

    append(name: string, value: FormDataEntryValueLike, filename?: string): void {
        assertValidValue('append', value);
        this.entries_.push({ name: String(name), value, filename });
    }

    set(name: string, value: FormDataEntryValueLike, filename?: string): void {
        assertValidValue('set', value);
        const key = String(name);
        const idx = this.entries_.findIndex((e) => e.name === key);
        this.delete(key);
        const entry: Entry = { name: key, value, filename };
        if (idx >= 0) this.entries_.splice(idx, 0, entry);
        else this.entries_.push(entry);
    }

    get(name: string): FormDataEntryValueLike | null {
        return this.entries_.find((e) => e.name === name)?.value ?? null;
    }

    getAll(name: string): FormDataEntryValueLike[] {
        return this.entries_.filter((e) => e.name === name).map((e) => e.value);
    }

    has(name: string): boolean {
        return this.entries_.some((e) => e.name === name);
    }

    delete(name: string): void {
        this.entries_ = this.entries_.filter((e) => e.name !== name);
    }

    forEach(fn: (value: FormDataEntryValueLike, name: string, parent: FormData) => void, thisArg?: unknown): void {
        for (const e of this.entries_) fn.call(thisArg, e.value, e.name, this);
    }

    *[Symbol.iterator](): IterableIterator<[string, FormDataEntryValueLike]> {
        for (const e of this.entries_) yield [e.name, e.value];
    }

    entries(): IterableIterator<[string, FormDataEntryValueLike]> {
        return this[Symbol.iterator]();
    }

    *keys(): IterableIterator<string> {
        for (const e of this.entries_) yield e.name;
    }

    *values(): IterableIterator<FormDataEntryValueLike> {
        for (const e of this.entries_) yield e.value;
    }

    /**
     * @internal Serialize entries to native multipart part descriptors,
     * preserving each entry's explicit `filename`. Lives on the class so
     * serialization doesn't reach into private state from outside.
     */
    _toNativeParts(): NativeMultipartPart[] {
        const parts: NativeMultipartPart[] = [];
        for (const e of this.entries_) {
            if (typeof e.value === 'string') {
                parts.push({ kind: 'field', name: sanitizeForDisposition(e.name), value: e.value });
            } else {
                // Precedence: explicit filename → handle name → 'file'.
                parts.push({
                    kind: 'file',
                    name: sanitizeForDisposition(e.name),
                    uri: e.value.uri,
                    filename: sanitizeForDisposition(e.filename ?? e.value.name ?? 'file'),
                    contentType: sanitizeContentType(e.value.mimeType ?? e.value.type),
                });
            }
        }
        return parts;
    }
}

/** RFC 2183 quoting for names/filenames inside Content-Disposition. */
function sanitizeForDisposition(s: string): string {
    return s.replace(/[\r\n"]/g, '_');
}

/**
 * The contentType lands on a multipart header line verbatim — strip CR/LF
 * so a malicious/buggy handle can't inject extra headers, and fall back
 * to octet-stream when nothing usable remains.
 */
function sanitizeContentType(ct: string | undefined): string {
    const cleaned = (ct ?? '').replace(/[\r\n]/g, '').trim();
    return cleaned.length > 0 ? cleaned : 'application/octet-stream';
}

/**
 * Serialize a FormData to the native multipart descriptor. The boundary is
 * generated here so `fetch` can put the SAME boundary in the Content-Type
 * header — native composes the body with it verbatim.
 */
export function formDataToNativeBody(form: FormData): Extract<NativeBody, { type: 'multipart' }> {
    const boundary = `----SigxFormBoundary${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return { type: 'multipart', boundary, parts: form._toNativeParts() };
}
