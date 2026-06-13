/**
 * DeviceInfo — verifies it routes through core's own `SigxCore` native module
 * (the bridge target after folding in @sigx/lynx-device-info).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceInfo, type DeviceInfoResult } from '../src/device-info.js';

type Globals = Record<string, unknown>;

const FULL_INFO: DeviceInfoResult = {
    manufacturer: 'Google',
    model: 'Pixel 9',
    brand: 'google',
    systemName: 'Android',
    systemVersion: '15',
    sdkVersion: 35,
    screenWidth: 1080,
    screenHeight: 2424,
    screenDensity: 2.75,
    appVersion: '1.2.3',
    appPackage: 'com.example.app',
};

afterEach(() => {
    delete (globalThis as Globals).NativeModules;
});

describe('DeviceInfo', () => {
    it('isAvailable() reflects whether the SigxCore module is registered', () => {
        expect(DeviceInfo.isAvailable()).toBe(false);
        (globalThis as Globals).NativeModules = { SigxCore: { getDeviceInfo: () => {} } };
        expect(DeviceInfo.isAvailable()).toBe(true);
    });

    it('getInfo() calls SigxCore.getDeviceInfo and resolves the callback payload', async () => {
        (globalThis as Globals).NativeModules = {
            SigxCore: {
                getDeviceInfo: (cb: (result: DeviceInfoResult) => void) => cb(FULL_INFO),
            },
        };
        await expect(DeviceInfo.getInfo()).resolves.toEqual(FULL_INFO);
    });
});
