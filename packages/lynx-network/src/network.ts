import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Network';

export type ConnectionType = 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'none' | 'unknown';

export interface NetworkState {
    isConnected: boolean;
    type: ConnectionType;
    isInternetReachable: boolean | null;
}

/**
 * Network connectivity APIs.
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
    getState(): Promise<NetworkState> {
        return callAsync<NetworkState>(MODULE, 'getState');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
