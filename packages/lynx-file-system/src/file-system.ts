import { callSync, callAsync, isModuleAvailable } from '@sigx/lynx-core';

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
