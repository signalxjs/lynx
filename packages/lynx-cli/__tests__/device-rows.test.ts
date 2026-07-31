/**
 * The Devices tab's model.
 *
 * The old tab listed only the targets picked at startup, which is why the
 * `d`/`a`/`i` keys fanned out to every device instead of acting on a selection.
 * These tests pin the replacement: everything detected, one addressable row
 * each, with activity that survives a rescan.
 */
import { describe, it, expect } from 'vitest';
import {
    buildDeviceRows, statusText, statusTone, isActionable, isBusy, targetRowId,
    type DeviceRow,
} from '../src/dev-ui/device-rows';
import type { DeviceStatus } from '../src/device-detect';
import type { SelectedTarget } from '../src/target-picker';

function status(over: Partial<DeviceStatus> = {}): DeviceStatus {
    return {
        devices: [],
        lynxGoInstalled: new Map(),
        adbAvailable: true,
        iosSimulators: [],
        xcrunAvailable: true,
        iosDevices: [],
        devicectlAvailable: true,
        ...over,
    };
}

describe('buildDeviceRows', () => {
    it('lists every detected device, not just the picked targets', () => {
        const rows = buildDeviceRows(status({
            devices: [{ id: 'RF8N', type: 'device', model: 'Pixel 8' }],
            iosSimulators: [{ udid: 'S1', name: 'iPhone 15', state: 'Booted', runtime: 'iOS 18' }],
            iosDevices: [{ udid: 'D1', name: 'Andy’s iPhone' }],
        }));
        expect(rows.map((r) => r.label)).toEqual(['Pixel 8', 'iPhone 15', 'Andy’s iPhone']);
        expect(rows.map((r) => r.form)).toEqual(['device', 'simulator', 'device']);
    });

    it('namespaces ids so a serial and a udid cannot collide', () => {
        const rows = buildDeviceRows(status({
            devices: [{ id: 'X1', type: 'device' }],
            iosSimulators: [{ udid: 'X1', name: 'Sim', state: 'Booted', runtime: 'iOS 18' }],
        }));
        expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    });

    it('carries the app/sandbox flags through', () => {
        const rows = buildDeviceRows(status({
            devices: [{ id: 'A', type: 'device' }, { id: 'B', type: 'device' }],
            appInstalled: new Map([['A', true]]),
            lynxGoInstalled: new Map([['B', true]]),
        }));
        expect(rows[0]).toMatchObject({ hasApp: true, hasSandbox: false });
        expect(rows[1]).toMatchObject({ hasApp: false, hasSandbox: true });
    });

    it('marks an offline device rather than hiding it', () => {
        // Hiding it makes an unauthorised phone look unplugged, which sends
        // people to the wrong end of the problem.
        const rows = buildDeviceRows(status({ devices: [{ id: 'A', type: 'offline' }] }));
        expect(rows[0]!.offline).toBe(true);
        expect(statusText(rows[0]!, '·')).toBe('offline');
        expect(isActionable(rows[0]!)).toBe(false);
    });

    it('shows a picked target that detection has not caught up with as pending', () => {
        const targets: SelectedTarget[] = [{ kind: 'ios-simulator', udid: 'S9', name: 'iPad', needsBoot: true }];
        const rows = buildDeviceRows(status(), targets);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ pending: true, label: 'iPad' });
        expect(statusText(rows[0]!, '·')).toBe('waiting…');
    });

    it('does not duplicate a picked target once it is detected', () => {
        const targets: SelectedTarget[] = [{ kind: 'ios-simulator', udid: 'S1', name: 'iPhone 15', needsBoot: false }];
        const rows = buildDeviceRows(
            status({ iosSimulators: [{ udid: 'S1', name: 'iPhone 15', state: 'Booted', runtime: 'iOS 18' }] }),
            targets,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.pending).toBe(false);
    });

    it('does not let a same-named detected device suppress a pending one', () => {
        // Label matching is an AVD-only fallback. Applied to every kind, one
        // simulator called "iPhone 15" would hide a genuinely pending physical
        // device of the same name — and you would never learn it was missing.
        const targets: SelectedTarget[] = [{ kind: 'ios-device', udid: 'D9', name: 'iPhone 15' }];
        const rows = buildDeviceRows(
            status({ iosSimulators: [{ udid: 'S1', name: 'iPhone 15', state: 'Booted', runtime: 'iOS 18' }] }),
            targets,
        );
        expect(rows).toHaveLength(2);
        expect(rows.filter((r) => r.pending)).toHaveLength(1);
    });

    it('reconciles a booted AVD by label, since adb reports a serial not the AVD name', () => {
        // `pnpm wt`-style gotcha: the AVD is picked as `Pixel_7_API_34` and
        // shows up as `emulator-5554`. Matching on id alone would list it twice.
        const targets: SelectedTarget[] = [{ kind: 'android-avd', avdName: 'Pixel_7_API_34' }];
        const rows = buildDeviceRows(
            status({ devices: [{ id: 'emulator-5554', type: 'emulator', model: 'Pixel_7_API_34' }] }),
            targets,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.pending).toBe(false);
    });

    it('keeps activity across a rescan', () => {
        // Pressing `d` mid-install must not drop the spinner.
        const before = buildDeviceRows(status({ devices: [{ id: 'A', type: 'device' }] }));
        before[0]!.activity = { phase: 'building', label: 'gradle installDebug' };

        const after = buildDeviceRows(
            status({ devices: [{ id: 'A', type: 'device' }] }),
            [],
            before,
        );
        expect(after[0]!.activity.phase).toBe('building');
        expect(after[0]!.activity.label).toBe('gradle installDebug');
    });

    it('starts a newly appeared device idle', () => {
        const before = buildDeviceRows(status({ devices: [{ id: 'A', type: 'device' }] }));
        before[0]!.activity = { phase: 'building' };
        const after = buildDeviceRows(status({ devices: [{ id: 'B', type: 'device' }] }), [], before);
        expect(after[0]!.activity.phase).toBe('idle');
    });
});

describe('targetRowId', () => {
    it('is unique per kind', () => {
        const ids = ([
            { kind: 'android-device', deviceId: 'x' },
            { kind: 'android-avd', avdName: 'x' },
            { kind: 'ios-simulator', udid: 'x', name: 'n', needsBoot: false },
            { kind: 'ios-device', udid: 'x', name: 'n' },
        ] as SelectedTarget[]).map(targetRowId);
        expect(new Set(ids).size).toBe(4);
    });
});

describe('statusText / statusTone', () => {
    const base: DeviceRow = {
        id: 'android:A', platform: 'android', form: 'device', handle: 'A', label: 'A',
        hasApp: false, hasSandbox: false, offline: false, pending: false,
        activity: { phase: 'idle' },
    };

    it('describes the resting states', () => {
        expect(statusText({ ...base, hasApp: true }, '·')).toBe('app ready');
        expect(statusText({ ...base, hasSandbox: true }, '·')).toBe('sandbox');
        expect(statusText(base, '·')).toBe('no app');
    });

    it('shows the spinner frame and phase while working', () => {
        expect(statusText({ ...base, activity: { phase: 'building', label: 'gradle' } }, '⠋')).toBe('⠋ gradle');
        expect(statusText({ ...base, activity: { phase: 'installing' } }, '⠙')).toBe('⠙ installing');
        expect(statusText({ ...base, activity: { phase: 'launching' } }, '⠹')).toBe('⠹ launching');
    });

    it('tones failure red and readiness green', () => {
        expect(statusTone({ ...base, activity: { phase: 'failed' } })).toBe('danger');
        expect(statusTone({ ...base, hasApp: true })).toBe('success');
        expect(statusTone({ ...base, offline: true })).toBe('dim');
        expect(statusTone({ ...base, pending: true })).toBe('warn');
    });

    it('is not actionable while work is in flight', () => {
        expect(isActionable(base)).toBe(true);
        expect(isActionable({ ...base, activity: { phase: 'building' } })).toBe(false);
        expect(isActionable({ ...base, activity: { phase: 'installing' } })).toBe(false);
    });

    it('stays actionable after a failure, so Enter can retry', () => {
        // A launch that failed is exactly the one you want to try again once
        // you have plugged the cable back in. Blocking it stranded the row
        // until the whole dev server was restarted.
        expect(isActionable({ ...base, activity: { phase: 'failed', error: 'boom' } })).toBe(true);
    });

    it('counts only in-flight work as busy, so the ticker stops after a failure', () => {
        // `failed` is a resting state. Treating it as busy left the 80ms
        // repaint loop running for the rest of the session.
        expect(isBusy({ ...base, activity: { phase: 'building' } })).toBe(true);
        expect(isBusy({ ...base, activity: { phase: 'launching' } })).toBe(true);
        expect(isBusy(base)).toBe(false);
        expect(isBusy({ ...base, activity: { phase: 'failed' } })).toBe(false);
    });
});
