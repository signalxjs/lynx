import { callSync, callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Clipboard';

/**
 * System clipboard APIs.
 *
 * Every method **throws** if the native module isn't linked, with the
 * descriptive error from core's `getModule` (CONVENTIONS.md C3). Feature-detect
 * with {@link Clipboard.isAvailable} rather than catching.
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
    /**
     * Write text to the system clipboard.
     *
     * Synchronous and `void` — a failed write is not reported. See the design
     * question on signalxjs/lynx#872.
     */
    setString(text: string): void {
        callSync(MODULE, 'setString', text);
    },

    /**
     * Read the clipboard's text. An empty clipboard resolves `''`.
     *
     * On iOS 14+ this surfaces a system "Pasted from …" toast, so call it on
     * user intent — a paste button — never on a poll.
     */
    getString(): Promise<string> {
        // Coalesce rather than assert: `callAsync<string>` only *declares* the
        // type, and a malformed native payload would otherwise be handed to
        // callers as a `string` that isn't one.
        return callAsync<string>(MODULE, 'getString').then((v) => (typeof v === 'string' ? v : ''));
    },

    /** Whether the clipboard currently holds text. */
    hasString(): Promise<boolean> {
        return callAsync<boolean>(MODULE, 'hasString').then((v) => v === true);
    },

    /**
     * Whether the native module is linked into this build (C2 — always
     * synchronous). Not a permission or capability check; the clipboard needs
     * neither on either platform.
     */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
