import {
    callSync,
    callAsync,
    isModuleAvailable,
    base64ToArrayBuffer,
    unwrapNative,
    unwrapNativeVoid,
    SigxError,
} from '@sigx/lynx-core';

const MODULE = 'FileSystem';
const PKG = 'lynx-file-system';

export interface FileInfo {
    uri: string;
    size: number;
    exists: boolean;
    isDirectory: boolean;
    /**
     * Last-modified time in epoch **milliseconds**, `0` when the file doesn't
     * exist. (iOS's `timeIntervalSince1970` is seconds; the native side scales
     * it so both platforms report the same number for the same file.)
     */
    modifiedAt: number;
}

/**
 * File system APIs.
 *
 * Every method **throws** on failure (C3/C4), always as a `SigxError` with a
 * `code` to branch on: `'module_unavailable'` when the native module isn't
 * linked (core's descriptive `getModule` error), `'native_error'` for a
 * failure reported by the platform — the natives resolve their callback with
 * `{ error }` rather than rejecting, so each call unwraps that envelope.
 *
 * @example
 * ```ts
 * import { FileSystem } from '@sigx/lynx-file-system';
 *
 * await FileSystem.writeFile('data.json', JSON.stringify({ key: 'value' }));
 * const content = await FileSystem.readFile('data.json');
 * ```
 */
export const FileSystem = {
    /** Read a file as UTF-8 text. Rejects if the file doesn't exist. */
    async readFile(path: string): Promise<string> {
        // `callAsync<string>` only *declares* the success shape — the failure
        // envelope arrives on the same resolved callback.
        return unwrapNative(PKG, 'readFile', await callAsync<string>(MODULE, 'readFile', path));
    },

    /**
     * Read a file as raw bytes, returned base64-encoded. Accepts the same
     * paths as `readFile`, plus `file://` URIs and (Android) `content://`
     * URIs — i.e. anything a picker hands back. Rejects on read failure.
     *
     * The whole file is materialized in memory (raw bytes natively, then a
     * base64 string ~33% larger crossing the bridge) — intended for small
     * to medium files. Don't route uploads through this: `@sigx/lynx-http`
     * FormData streams files natively from their URI instead.
     */
    async readFileBase64(path: string): Promise<string> {
        const raw = unwrapNative(
            PKG,
            'readFileBase64',
            await callAsync<unknown>(MODULE, 'readFileBase64', path),
        );
        if (typeof raw === 'string') return raw;
        // Not an `{ error }` envelope and not base64 either — don't hand a
        // non-string back to callers typed as one.
        throw new SigxError(
            PKG,
            'native_error',
            `[@sigx/${PKG}] readFileBase64 failed: unexpected payload of type ${typeof raw}`,
            { cause: raw },
        );
    },

    /** `readFileBase64` decoded to an `ArrayBuffer`. */
    async readFileAsArrayBuffer(path: string): Promise<ArrayBuffer> {
        // Reference the sibling via the const (not `this`) so the method
        // survives destructuring like the rest of the FileSystem API.
        return base64ToArrayBuffer(await FileSystem.readFileBase64(path));
    },

    /**
     * Write UTF-8 text, creating parent directories as needed. Rejects if the
     * write fails — an unwritable path, or a full volume.
     */
    async writeFile(path: string, content: string): Promise<void> {
        unwrapNativeVoid(
            PKG,
            'writeFile',
            await callAsync<unknown>(MODULE, 'writeFile', path, content),
        );
    },

    /**
     * Delete a file the app owns. Deleting something that isn't there is a
     * no-op on both platforms; a real failure — a read-only path, or a
     * non-empty directory on Android (iOS removes those recursively) —
     * rejects.
     *
     * A picker's `content://` URI is **not** a path the app owns, so deleting
     * one rejects on Android rather than reporting a success that deleted
     * nothing. A `file://` URI is fine: pickers that hand one back have copied
     * the bytes into the app sandbox already.
     */
    async deleteFile(path: string): Promise<void> {
        unwrapNativeVoid(PKG, 'deleteFile', await callAsync<unknown>(MODULE, 'deleteFile', path));
    },

    /**
     * Stat a path. A missing file resolves a `FileInfo` with `exists: false`
     * and zeroed fields; a failing native stat — a protected-data file on a
     * locked iOS device, a permission-denied path — rejects rather than
     * resolving a `FileInfo` that would read as an empty file.
     */
    async getInfo(path: string): Promise<FileInfo> {
        return unwrapNative(PKG, 'getInfo', await callAsync<FileInfo>(MODULE, 'getInfo', path));
    },

    /** Get the app's document directory path. */
    getDocumentDirectory(): string {
        return callSync<string>(MODULE, 'getDocumentDirectory');
    },

    /** Get the app's cache directory path. */
    getCacheDirectory(): string {
        return callSync<string>(MODULE, 'getCacheDirectory');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
