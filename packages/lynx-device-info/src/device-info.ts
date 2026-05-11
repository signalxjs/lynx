import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'DeviceInfo';

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
 * Device information APIs.
 *
 * @example
 * ```ts
 * import { DeviceInfo } from '@sigx/lynx-device-info';
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
