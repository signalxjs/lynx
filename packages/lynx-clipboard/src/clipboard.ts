import { callSync, callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Clipboard';

/**
 * System clipboard APIs.
 *
 * @example
 * ```ts
 * import { Clipboard } from '@sigx/lynx-clipboard';
 *
 * Clipboard.setString('Hello, world!');
 * const text = await Clipboard.getString();
 * ```
 */
export const Clipboard = {
    setString(text: string): void {
        callSync(MODULE, 'setString', text);
    },

    getString(): Promise<string> {
        return callAsync<string>(MODULE, 'getString');
    },

    hasString(): Promise<boolean> {
        return callAsync<boolean>(MODULE, 'hasString');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
