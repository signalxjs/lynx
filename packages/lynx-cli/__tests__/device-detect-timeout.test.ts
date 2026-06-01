/**
 * Regression tests for the device-command timeout guard.
 *
 * A wedged `adbd` makes `adb shell …` block forever; before the guard the
 * dev flow stalled silently right after "prebuild complete". These tests
 * lock in that every adb probe (a) bounds its wait with a `timeout` and
 * (b) surfaces a one-time, actionable warning instead of hanging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({
    execSync: (...args: unknown[]) => execSyncMock(...args),
}));

// Imported after the mock is registered.
const {
    pingDevice,
    isAppInstalled,
    listAndroidDevices,
    resetDeviceWarnings,
    DEVICE_CMD_TIMEOUT_MS,
    DEVICE_ACTION_TIMEOUT_MS,
    isAppInstalledOnSimulator,
    bootSimulator,
    listBootedSimulators,
    adbReverseRemove,
} = await import('../src/device-detect');

/** Build the error shape Node's execSync throws when a timeout fires. */
function timeoutError(): Error {
    return Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGTERM', status: null });
}

/** A normal non-zero exit (e.g. an offline device that errors quickly). */
function exitError(): Error {
    return Object.assign(new Error('exit 1'), { status: 1 });
}

let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    execSyncMock.mockReset();
    resetDeviceWarnings();
    // First call in any probe is `adb version` (resolveAdb) — make it succeed
    // so a real `adb` resolves and the cache is primed deterministically.
    execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes(' version')) return 'Android Debug Bridge';
        throw exitError();
    });
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
    stderr.mockRestore();
});

describe('execDevice timeout guard', () => {
    it('passes a finite timeout to every device command', () => {
        isAppInstalled('DEV1', 'com.example.app');
        const deviceCall = execSyncMock.mock.calls.find(([c]) => String(c).includes('pm list packages'));
        expect(deviceCall).toBeDefined();
        expect((deviceCall![1] as { timeout?: number }).timeout).toBe(DEVICE_CMD_TIMEOUT_MS);
    });

    it('pingDevice flags a wedged device as unresponsive + timed out', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            if (cmd.includes(' version')) return 'ok';
            throw timeoutError();
        });
        expect(pingDevice('WEDGED')).toEqual({ responsive: false, timedOut: true });
    });

    it('emits a single actionable warning per device on timeout', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            if (cmd.includes(' version')) return 'ok';
            throw timeoutError();
        });
        pingDevice('WEDGED');
        isAppInstalled('WEDGED', 'com.example.app'); // same device — must not re-warn
        expect(stderr).toHaveBeenCalledTimes(1);
        const msg = String(stderr.mock.calls[0][0]);
        expect(msg).toContain('WEDGED');
        expect(msg).toContain('kill-server');
        expect(msg).toContain('10s'); // second-scale probe timeout, reported exactly
    });

    it('reports a sub-second timeout in ms (not a rounded "1s")', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            if (cmd.includes(' version')) return 'ok';
            throw timeoutError();
        });
        adbReverseRemove('DEV9', 8788); // 750ms best-effort timeout
        const msg = String(stderr.mock.calls.at(-1)?.[0] ?? '');
        expect(msg).toContain('750ms');
        expect(msg).not.toContain('1s)');
    });

    it('refuses a device id with shell metacharacters without spawning a shell', () => {
        expect(isAppInstalled('dev; rm -rf /', 'com.example.app')).toBe(false);
        // The malicious id must never reach execSync.
        const ranWithId = execSyncMock.mock.calls.some(([c]) => String(c).includes('rm -rf'));
        expect(ranWithId).toBe(false);
        const msg = String(stderr.mock.calls.at(-1)?.[0] ?? '');
        expect(msg).toContain('unsafe device identifier');
    });

    it('allows normal serials and udids (alphanumerics + . _ : -)', () => {
        execSyncMock.mockImplementation(() => 'ok');
        // A real adb serial and an emulator-style id both pass the guard.
        pingDevice('47251FDAS00A6T');
        pingDevice('emulator-5554');
        const ran = execSyncMock.mock.calls.filter(([c]) => String(c).includes('shell true'));
        expect(ran.length).toBe(2);
    });

    it('treats a fast non-zero exit as "not installed" without warning', () => {
        // Offline device: errors quickly rather than hanging — no timeout, no warn.
        expect(isAppInstalled('OFFLINE', 'com.example.app')).toBe(false);
        expect(stderr).not.toHaveBeenCalled();
    });

    it('healthy device: responsive, no warning', () => {
        execSyncMock.mockImplementation(() => 'ok'); // every command succeeds
        expect(pingDevice('HEALTHY')).toEqual({ responsive: true, timedOut: false });
        expect(stderr).not.toHaveBeenCalled();
    });

    it('listAndroidDevices returns [] (not a throw) when adb times out', () => {
        execSyncMock.mockImplementation((cmd: string) => {
            if (cmd.includes(' version')) return 'ok';
            throw timeoutError();
        });
        expect(listAndroidDevices()).toEqual([]);
    });
});

describe('iOS parity (simctl / devicectl)', () => {
    it('simctl probe timeout warns with the simulator-specific hint', () => {
        execSyncMock.mockImplementation(() => { throw timeoutError(); });
        expect(isAppInstalledOnSimulator('UDID-1', 'com.example.app')).toBe(false);
        expect(stderr).toHaveBeenCalledTimes(1);
        const msg = String(stderr.mock.calls[0][0]);
        expect(msg).toContain('UDID-1');
        expect(msg).toContain('simctl shutdown all'); // simulator hint, not the adb one
        expect(msg).not.toContain('kill-server');
    });

    it('booting a simulator uses the longer action timeout, not the probe timeout', () => {
        execSyncMock.mockImplementation(() => 'ok');
        bootSimulator('UDID-2');
        const bootCall = execSyncMock.mock.calls.find(([c]) => String(c).includes('simctl boot'));
        expect(bootCall).toBeDefined();
        expect((bootCall![1] as { timeout?: number }).timeout).toBe(DEVICE_ACTION_TIMEOUT_MS);
        expect(DEVICE_ACTION_TIMEOUT_MS).toBeGreaterThan(DEVICE_CMD_TIMEOUT_MS);
    });

    it('a daemon-wide simctl timeout labels the service, not a device', () => {
        execSyncMock.mockImplementation(() => { throw timeoutError(); });
        expect(listBootedSimulators()).toEqual([]);
        const msg = String(stderr.mock.calls[0][0]);
        expect(msg).toContain('iOS simulator service');
        expect(msg).not.toContain('Device');
    });
});
