import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'Location';

export interface LocationResult {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    speed: number | null;
    heading: number | null;
    timestamp: number;
}

export interface LocationOptions {
    /** Desired accuracy: 'high', 'balanced', 'low' */
    accuracy?: 'high' | 'balanced' | 'low';
    /** Timeout in milliseconds */
    timeout?: number;
}

/**
 * Location services APIs.
 *
 * @example
 * ```ts
 * import { Location } from '@sigx/lynx-location';
 *
 * const { status } = await Location.requestPermission();
 * if (status === 'granted') {
 *     const loc = await Location.getCurrentPosition({ accuracy: 'high' });
 *     console.log(loc.latitude, loc.longitude);
 * }
 * ```
 */
export const Location = {
    getCurrentPosition(options: LocationOptions = {}): Promise<LocationResult> {
        return callAsync<LocationResult>(MODULE, 'getCurrentPosition', options);
    },

    /** Request location permission, showing the OS dialog if needed. */
    requestPermission(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'requestPermission');
    },

    /** Check current location permission status without prompting. */
    getPermissionStatus(): Promise<PermissionResponse> {
        return callAsync<PermissionResponse>(MODULE, 'getPermissionStatus');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
