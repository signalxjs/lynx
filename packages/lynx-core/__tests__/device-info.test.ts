/**
 * DeviceInfo — verifies it routes through core's own `SigxCore` native module
 * (the bridge target after folding in @sigx/lynx-device-info) and that the
 * normalized, platform-discriminated payloads round-trip through `getInfo()`.
 *
 * The native side normalizes its raw payload to the documented shape (identical
 * keys/units per platform, plus a `platform` discriminant). Vitest runs JS only,
 * so these mocks stand in for what each native module now emits, pinning the
 * contract that `DeviceInfoResult` declares.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
    DeviceInfo,
    type AndroidDeviceInfo,
    type IosDeviceInfo,
} from '../src/device-info.js';

type Globals = Record<string, unknown>;

const IOS_INFO: IosDeviceInfo = {
    platform: 'ios',
    manufacturer: 'Apple',
    model: 'iPhone',
    brand: 'Apple',
    systemName: 'iOS',
    systemVersion: '18.2',
    appVersion: '1.2.3',
    deviceId: 'A1B2C3D4-0000-1111-2222-333344445555',
    screenWidth: 393,
    screenHeight: 852,
    screenScale: 3,
    modelName: 'iPhone16,2',
    appBuildNumber: '42',
    bundleId: 'com.example.app',
};

const ANDROID_INFO: AndroidDeviceInfo = {
    platform: 'android',
    manufacturer: 'Google',
    model: 'Pixel 9',
    brand: 'google',
    systemName: 'Android',
    systemVersion: '15',
    appVersion: '1.2.3',
    deviceId: 'AP4A.250105.002',
    screenWidth: 393, // dp, normalized from 1080px / 2.75
    screenHeight: 881, // dp, normalized from 2424px / 2.75
    screenScale: 2.75,
    sdkVersion: 35,
    appPackage: 'com.example.app',
};

function mockGetDeviceInfo(payload: unknown): void {
    (globalThis as Globals).NativeModules = {
        SigxCore: {
            getDeviceInfo: (cb: (result: unknown) => void) => cb(payload),
        },
    };
}

afterEach(() => {
    delete (globalThis as Globals).NativeModules;
});

describe('DeviceInfo', () => {
    it('isAvailable() reflects whether the SigxCore module is registered', () => {
        expect(DeviceInfo.isAvailable()).toBe(false);
        (globalThis as Globals).NativeModules = { SigxCore: { getDeviceInfo: () => {} } };
        expect(DeviceInfo.isAvailable()).toBe(true);
    });

    it('getInfo() resolves the iOS payload and narrows on platform', async () => {
        mockGetDeviceInfo(IOS_INFO);
        const info = await DeviceInfo.getInfo();
        expect(info).toEqual(IOS_INFO);
        // Discriminant narrows to the iOS-only extras.
        if (info.platform === 'ios') {
            expect(info.modelName).toBe('iPhone16,2');
            expect(info.bundleId).toBe('com.example.app');
            expect(info.appBuildNumber).toBe('42');
        } else {
            throw new Error('expected iOS payload');
        }
    });

    it('getInfo() resolves the Android payload with dp screen dims and scale', async () => {
        mockGetDeviceInfo(ANDROID_INFO);
        const info = await DeviceInfo.getInfo();
        expect(info).toEqual(ANDROID_INFO);
        if (info.platform === 'android') {
            expect(info.sdkVersion).toBe(35);
            expect(info.appPackage).toBe('com.example.app');
            // Screen dims are density-independent points, not raw pixels.
            expect(info.screenWidth).toBe(393);
            expect(info.screenScale).toBe(2.75);
            expect(info).not.toHaveProperty('screenDensity');
        } else {
            throw new Error('expected Android payload');
        }
    });
});
