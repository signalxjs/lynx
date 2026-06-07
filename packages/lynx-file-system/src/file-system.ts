import { callSync, callAsync, isModuleAvailable, base64ToArrayBuffer } from '@sigx/lynx-core';

const MODULE = 'FileSystem';

export interface FileInfo {
    uri: string;
    size: number;
    exists: boolean;
    isDirectory: boolean;
    modifiedAt: number;
}

/**
 * File system APIs.
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
    readFile(path: string): Promise<string> {
        return callAsync<string>(MODULE, 'readFile', path);
    },

    /**
     * Read a file as raw bytes, returned base64-encoded. Accepts the same
     * paths as `readFile`, plus `file://` URIs and (Android) `content://`
     * URIs — i.e. anything a picker hands back. Rejects on read failure.
     */
    async readFileBase64(path: string): Promise<string> {
        const r = await callAsync<unknown>(MODULE, 'readFileBase64', path);
        if (typeof r === 'string') return r;
        const err = (r as { error?: string } | null)?.error ?? 'readFileBase64 failed';
        throw new Error(`[@sigx/lynx-file-system] ${err}`);
    },

    /** `readFileBase64` decoded to an `ArrayBuffer`. */
    async readFileAsArrayBuffer(path: string): Promise<ArrayBuffer> {
        // Reference the sibling via the const (not `this`) so the method
        // survives destructuring like the rest of the FileSystem API.
        return base64ToArrayBuffer(await FileSystem.readFileBase64(path));
    },

    writeFile(path: string, content: string): Promise<void> {
        return callAsync<void>(MODULE, 'writeFile', path, content);
    },

    deleteFile(path: string): Promise<void> {
        return callAsync<void>(MODULE, 'deleteFile', path);
    },

    getInfo(path: string): Promise<FileInfo> {
        return callAsync<FileInfo>(MODULE, 'getInfo', path);
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
