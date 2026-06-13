/**
 * DeviceInfo — verifies it routes through core's own `SigxCore` native module
 * (the bridge target after folding in @sigx/lynx-device-info).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceInfo } from '../src/device-info.js';

type Globals = Record<string, unknown>;

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
        const payload = { model: 'Pixel 9', systemName: 'Android' };
        (globalThis as Globals).NativeModules = {
            SigxCore: {
                getDeviceInfo: (cb: (result: unknown) => void) => cb(payload),
            },
        };
        await expect(DeviceInfo.getInfo()).resolves.toEqual(payload);
    });
});
