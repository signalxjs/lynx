import { callAsync, isModuleAvailable } from './bridge.js';

// Device info is served by core's own native module (`SigxCore`), which also
// hosts the activity hook. See signalx-module.json + the moved
// DeviceInfoModule.{swift,kt} under ios/ and android/.
const MODULE = 'SigxCore';

/**
 * Fields guaranteed on every platform, with identical semantics and units. The
 * native side ({@link DeviceInfoModule}) normalizes its raw payload to these
 * keys before resolving, so consumers never branch for the common case.
 */
interface DeviceInfoCommon {
    /** Discriminant — narrows to the per-platform extras below. */
    platform: 'ios' | 'android';
    manufacturer: string;
    /**
     * Friendly model name (Android `Build.MODEL`, e.g. `"Pixel 9"`). On iOS this
     * is the generic `UIDevice.model` (`"iPhone"`); the hardware identifier lives
     * in {@link IosDeviceInfo.modelName}.
     */
    model: string;
    brand: string;
    systemName: string;
    systemVersion: string;
    appVersion: string;
    /**
     * iOS: per-vendor stable device UUID (`identifierForVendor`).
     * Android: `Build.ID` (a build identifier, not a stable device id).
     */
    deviceId: string;
    /** Density-independent points (dp / pt) on both platforms. */
    screenWidth: number;
    /** Density-independent points (dp / pt) on both platforms. */
    screenHeight: number;
    /** Logical→physical multiplier — physical px = `screenWidth * screenScale`. */
    screenScale: number;
}

/** iOS-specific extras, present when `platform === 'ios'`. */
export interface IosDeviceInfo extends DeviceInfoCommon {
    platform: 'ios';
    /** Hardware identifier, e.g. `"iPhone16,2"`. */
    modelName: string;
    /** `CFBundleVersion`. */
    appBuildNumber: string;
    bundleId: string;
}

/** Android-specific extras, present when `platform === 'android'`. */
export interface AndroidDeviceInfo extends DeviceInfoCommon {
    platform: 'android';
    /** `Build.VERSION.SDK_INT`. */
    sdkVersion: number;
    appPackage: string;
}

/**
 * Platform-discriminated device info. Switch on {@link DeviceInfoCommon.platform}
 * to access the per-platform extras type-safely.
 */
export type DeviceInfoResult = IosDeviceInfo | AndroidDeviceInfo;

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
 * if (info.platform === 'ios') console.log(info.bundleId);
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
