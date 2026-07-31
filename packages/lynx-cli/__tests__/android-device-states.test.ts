/**
 * `adb devices -l` state classification.
 *
 * The dashboard shows offline/unauthorised devices rather than hiding them, so
 * the classification has to be right — and `offline` is not the state most
 * people actually hit. A handset whose "Allow USB debugging?" prompt is
 * unanswered reports `unauthorized`, and treating that as a normal device made
 * it look launchable while every adb command against it failed.
 */
import { describe, it, expect } from 'vitest';
import { classifyAndroidDevice } from '../src/device-detect';
import { buildDeviceRows, isActionable } from '../src/dev-ui/device-rows';

describe('classifyAndroidDevice', () => {
    it('accepts only the literal `device` state as usable', () => {
        expect(classifyAndroidDevice('RF8N1234', 'device')).toBe('device');
    });

    it('treats an unanswered USB-debugging prompt as offline', () => {
        // The case that motivated the change, and the one users hit most.
        expect(classifyAndroidDevice('RF8N1234', 'unauthorized')).toBe('offline');
    });

    it('treats every other non-`device` state as offline', () => {
        for (const state of ['offline', 'connecting', 'recovery', 'bootloader', 'sideload', 'host']) {
            expect(classifyAndroidDevice('RF8N1234', state), state).toBe('offline');
        }
    });

    it('treats a missing state as offline rather than assuming the best', () => {
        // A malformed `adb devices` row should not produce a device the UI
        // then offers to launch on.
        expect(classifyAndroidDevice('RF8N1234', undefined)).toBe('offline');
        expect(classifyAndroidDevice('RF8N1234', '')).toBe('offline');
    });

    it('classifies emulators by id first, so a booting one is still an emulator', () => {
        // The AVD launch flow waits for a booting emulator rather than writing
        // it off; reclassifying it as offline would break that.
        expect(classifyAndroidDevice('emulator-5554', 'offline')).toBe('emulator');
        expect(classifyAndroidDevice('emulator-5554', 'device')).toBe('emulator');
        expect(classifyAndroidDevice('localhost:5555', 'offline')).toBe('emulator');
    });
});

describe('classification reaches the table', () => {
    it('renders an unusable device as offline and refuses to launch on it', () => {
        const rows = buildDeviceRows({
            devices: [
                { id: 'RF8N', type: classifyAndroidDevice('RF8N', 'unauthorized'), model: 'Pixel 8' },
                { id: 'RF9M', type: classifyAndroidDevice('RF9M', 'device'), model: 'Pixel 9' },
            ],
            lynxGoInstalled: new Map(),
            appInstalled: new Map(),
            adbAvailable: true,
            iosSimulators: [],
            xcrunAvailable: true,
            iosDevices: [],
            devicectlAvailable: true,
        });
        expect(rows[0]!.offline).toBe(true);
        expect(isActionable(rows[0]!)).toBe(false);
        expect(rows[1]!.offline).toBe(false);
        expect(isActionable(rows[1]!)).toBe(true);
    });
});
