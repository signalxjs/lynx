import { callSync, callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Storage';

/**
 * Persistent key-value storage APIs.
 *
 * @example
 * ```ts
 * import { Storage } from '@sigx/lynx-storage';
 *
 * Storage.setItem('user', JSON.stringify({ name: 'Alice' }));
 * const user = await Storage.getItem('user');
 * ```
 */
export const Storage = {
    setItem(key: string, value: string): void {
        callSync(MODULE, 'setItem', key, value);
    },

    getItem(key: string): Promise<string | null> {
        return callAsync<string | null>(MODULE, 'getItem', key);
    },

    removeItem(key: string): void {
        callSync(MODULE, 'removeItem', key);
    },

    clear(): void {
        callSync(MODULE, 'clear');
    },

    getAllKeys(): Promise<string[]> {
        return callAsync<string[]>(MODULE, 'getAllKeys');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
