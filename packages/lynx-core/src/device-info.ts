import { callAsync, isModuleAvailable } from './bridge.js';

// Device info is served by core's own native module (`SigxCore`), which also
// hosts the activity hook. See signalx-module.json + the moved
// DeviceInfoModule.{swift,kt} under ios/ and android/.
const MODULE = 'SigxCore';

export interface DeviceInfoResult {
    manufacturer: string;
    model: string;
    brand: string;
    systemName: string;
    systemVersion: string;
    sdkVersion: number;
    screenWidth: number;
    screenHeight: number;
    screenDensity: number;
    appVersion: string;
    appPackage: string;
}

/**
 * Device information APIs. Async, native-backed (manufacturer / model / brand /
 * app version) — complements the synchronous {@link Platform} surface, which is
 * sourced from `SystemInfo`.
 *
 * @example
 * ```ts
 * import { DeviceInfo } from '@sigx/lynx';
 *
 * const info = await DeviceInfo.getInfo();
 * console.log(info.model);
 * ```
 */
export const DeviceInfo = {
    getInfo(): Promise<DeviceInfoResult> {
        return callAsync<DeviceInfoResult>(MODULE, 'getDeviceInfo');
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
