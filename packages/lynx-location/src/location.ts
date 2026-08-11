import { callAsync, isModuleAvailable, unwrapNative } from '@sigx/lynx-core';
import type { PermissionResponse } from '@sigx/lynx-core';

const MODULE = 'Location';
const PKG = 'lynx-location';

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
 * Every method **throws** if the native module isn't linked, with the
 * descriptive error from core's `getModule` (CONVENTIONS.md C3), and rejects
 * with a `SigxError` (`code: 'native_error'`) when the platform reports a
 * failure — both natives signal permission-denied, "no fix" and exceptions as
 * a *resolved* `{ error }` payload, which used to reach callers as a
 * `LocationResult` full of `undefined` (C4).
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
    /**
     * One-shot position fix.
     *
     * Rejects when the platform can't produce one — permission not granted,
     * no fix available, or a native exception.
     */
    async getCurrentPosition(options: LocationOptions = {}): Promise<LocationResult> {
        return unwrapNative(
            PKG,
            'getCurrentPosition',
            await callAsync<LocationResult>(MODULE, 'getCurrentPosition', options),
        );
    },

    /**
     * Request location permission, showing the OS dialog if needed.
     *
     * A *denied* permission is not a failure — it resolves with
     * `status: 'denied'` / `'blocked'`. Only a native error rejects.
     */
    async requestPermission(): Promise<PermissionResponse> {
        return unwrapNative(
            PKG,
            'requestPermission',
            await callAsync<PermissionResponse>(MODULE, 'requestPermission'),
        );
    },

    /** Check current location permission status without prompting. */
    async getPermissionStatus(): Promise<PermissionResponse> {
        return unwrapNative(
            PKG,
            'getPermissionStatus',
            await callAsync<PermissionResponse>(MODULE, 'getPermissionStatus'),
        );
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
