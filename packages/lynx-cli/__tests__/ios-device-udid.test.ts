/**
 * Regression test for the identifier a connected iOS device reports.
 *
 * `devicectl` gives a device two identities: a CoreDevice `identifier`
 * (`16B3FA2D-…`) and the `hardwareProperties.udid` (`00008132-…`). Both work
 * for `devicectl --device`, but `xcodebuild -destination id=…` matches only
 * the hardware one — and returning the wrong one failed every physical-device
 * build with "Unable to find a device matching the provided destination
 * specifier", which reads like a signing or pairing fault and is neither.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
    execSync: (...args: unknown[]) => execSyncMock(...args),
}));

// `runDevicectlJson` passes `--json-output <tmpfile>` and reads the file back,
// so the payload has to arrive through `readFileSync`, not stdout.
let devicectlOutput = '';
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
        ...actual,
        readFileSync: (path: string, ...rest: unknown[]) =>
            String(path).includes('sigx-devicectl-')
                ? devicectlOutput
                : (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest),
        unlinkSync: (path: string) =>
            String(path).includes('sigx-devicectl-')
                ? undefined
                : actual.unlinkSync(path),
    };
});

const { listConnectedIosDevices } = await import('../src/device-detect');
const { iosBuildArgs, createIosDeviceTroubleWatcher } = await import('../src/ios-run');

const HARDWARE_UDID = '00008132-001871DE0123401C';
const CORE_DEVICE_ID = '16B3FA2D-976E-5DC4-A5F4-3B6644104171';

/** Stage one entry shaped like `xcrun devicectl list devices --json-output`. */
function devicectlJson(device: Record<string, unknown>): string {
    return JSON.stringify({ result: { devices: [device] } });
}

const IPAD = {
    identifier: CORE_DEVICE_ID,
    deviceProperties: { name: 'Andtiis Ipad Pro', osVersionNumber: '26.6' },
    hardwareProperties: {
        marketingName: 'iPad Air 13-inch (M4)',
        udid: HARDWARE_UDID,
        platform: 'iOS',
    },
    connectionProperties: { pairingState: 'paired', transportType: 'wired' },
};

beforeEach(() => {
    execSyncMock.mockReset();
    execSyncMock.mockReturnValue('');
    devicectlOutput = devicectlJson(IPAD);
});

describe('listConnectedIosDevices', () => {
    it('reports the hardware UDID, not the CoreDevice identifier', () => {
        const [device] = listConnectedIosDevices();

        expect(device?.udid).toBe(HARDWARE_UDID);
        expect(device?.udid).not.toBe(CORE_DEVICE_ID);
    });

    it('carries the rest of the device through', () => {
        const [device] = listConnectedIosDevices();

        expect(device).toMatchObject({
            name: 'Andtiis Ipad Pro',
            model: 'iPad Air 13-inch (M4)',
            osVersion: '26.6',
            transport: 'wired',
        });
    });

    it('falls back to the CoreDevice identifier when no hardware UDID is reported', () => {
        // Older devicectl output, and better than dropping the device: it
        // still installs and launches, it just can't be an xcodebuild target.
        devicectlOutput = devicectlJson({
            ...IPAD,
            hardwareProperties: { ...IPAD.hardwareProperties, udid: undefined },
        });

        expect(listConnectedIosDevices()[0]?.udid).toBe(CORE_DEVICE_ID);
    });

    it('skips simulators, unpaired devices, and anything with no identifier at all', () => {
        devicectlOutput = JSON.stringify({
            result: {
                devices: [
                    { ...IPAD, hardwareProperties: { ...IPAD.hardwareProperties, platform: 'watchOS' } },
                    { ...IPAD, connectionProperties: { pairingState: 'unpaired' } },
                    {
                        ...IPAD,
                        identifier: undefined,
                        hardwareProperties: { ...IPAD.hardwareProperties, udid: undefined },
                    },
                ],
            },
        });

        expect(listConnectedIosDevices()).toEqual([]);
    });
});

describe('iosBuildArgs', () => {
    const base = {
        workspace: 'ios/showcase.xcworkspace',
        scheme: 'showcase',
        destinationId: HARDWARE_UDID,
        configuration: 'Release',
        derivedDataPath: '/proj/ios/build',
    };

    it('asks for provisioning updates on a device build', () => {
        // Without it, automatic signing will not create or refresh a profile,
        // and a first build to a newly registered device fails with
        // "No profiles for '<bundle id>' were found" — with the team set.
        expect(iosBuildArgs({ ...base, isDevice: true })).toContain('-allowProvisioningUpdates');
    });

    it('does not ask on a simulator build', () => {
        // Simulator builds are unsigned; the flag would only buy round-trips
        // to Apple.
        expect(iosBuildArgs({ ...base, isDevice: false }))
            .not.toContain('-allowProvisioningUpdates');
    });

    it('targets the device by id and keeps derived data project-local', () => {
        const args = iosBuildArgs({ ...base, isDevice: true });

        expect(args).toEqual(expect.arrayContaining([
            '-destination', `id=${HARDWARE_UDID}`,
            '-derivedDataPath', '/proj/ios/build',
        ]));
        expect(args.at(-1)).toBe('build');
    });
});

describe('createIosDeviceTroubleWatcher', () => {
    const target = { name: 'Andtiis Ipad Pro', udid: HARDWARE_UDID };
    const watch = (line: string) => {
        const w = createIosDeviceTroubleWatcher();
        w.onChunk(Buffer.from(line));
        return w.message(target);
    };

    it('names a device that is connected but not ready', () => {
        // The DDI is unmounted — unlocking the device is the usual fix, and
        // xcodebuild says only "Device is busy".
        expect(watch('error:Device is busy (Waiting to reconnect to Andtiis Ipad Pro)'))
            .toMatch(/connected but not ready/);
    });

    it('names an unmatched destination, with the identifier hint', () => {
        expect(watch('xcodebuild: error: Unable to find a device matching the provided destination specifier'))
            .toMatch(/hardware UDID/);
    });

    it('names a bundle identifier the team cannot register', () => {
        // Device-seen with the scaffold placeholder: without this it fell
        // through to the signing guess, which is the wrong thing to check.
        expect(watch('error: Failed Registering Bundle Identifier'))
            .toMatch(/SIGX_IOS_BUNDLE_ID/);
    });

    it('falls back to signing, naming both overrides', () => {
        const message = watch('error: something else entirely');
        expect(message).toMatch(/development team is selected/);
        expect(message).toMatch(/SIGX_IOS_DEVELOPMENT_TEAM/);
    });
});
