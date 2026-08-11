import { callAsync, isModuleAvailable, unwrapNative } from '@sigx/lynx-core';

const MODULE = 'Network';
const PKG = 'lynx-network';

export type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'none' | 'unknown';

export interface NetworkState {
    isConnected: boolean;
    type: ConnectionType;
    isInternetReachable: boolean | null;
}

/**
 * Network connectivity APIs.
 *
 * Every method **throws** if the native module isn't linked, with the
 * descriptive error from core's `getModule` (CONVENTIONS.md C3). Feature-detect
 * with {@link Network.isAvailable} rather than catching.
 *
 * @example
 * ```ts
 * import { Network } from '@sigx/lynx-network';
 *
 * const state = await Network.getState();
 * console.log(state.isConnected, state.type);
 * ```
 */
export const Network = {
    /**
     * Snapshot the current connectivity state.
     *
     * Rejects with a `SigxError` (`code: 'native_error'`) when the native side
     * fails — Android wraps its whole body in a catch-all that replies
     * `{ error }`. That envelope used to be handed back *as* a `NetworkState`,
     * so a failure arrived as `isConnected: undefined` and the offline branch
     * of `if (state.isConnected)` ran with no `catch` ever firing (C4).
     */
    async getState(): Promise<NetworkState> {
        return unwrapNative(PKG, 'getState', await callAsync<NetworkState>(MODULE, 'getState'));
    },

    /**
     * Whether the native module is linked into this build (C2 — always
     * synchronous). Not a permission check; connectivity status needs none on
     * either platform.
     */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
