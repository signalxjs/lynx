/**
 * Device detection utilities.
 *
 * Detects connected Android devices/emulators via ADB and iOS simulators
 * via xcrun simctl. Checks whether sigx-lynx-go or custom apps are installed.
 * Used by the dev server to show device status and optionally auto-launch.
 */

import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface AndroidDevice {
    id: string;
    type: 'device' | 'emulator' | 'offline';
    model?: string;
}

export interface IosSimulator {
    udid: string;
    name: string;
    state: string;
    runtime: string;
}

export interface IosDevice {
    /** devicectl identifier (UUID string). Use with `--device <identifier>`. */
    udid: string;
    /** User-facing device name. */
    name: string;
    /** Marketing name (e.g., "iPhone 15 Pro") if available. */
    model?: string;
    /** OS version reported by devicectl. */
    osVersion?: string;
    /** "wired" | "wireless" */
    transport?: string;
}

export interface DeviceStatus {
    devices: AndroidDevice[];
    lynxGoInstalled: Map<string, boolean>;
    appInstalled?: Map<string, boolean>;
    adbAvailable: boolean;
    iosSimulators: IosSimulator[];
    xcrunAvailable: boolean;
    iosAppInstalled?: Map<string, boolean>;
    iosDevices: IosDevice[];
    devicectlAvailable: boolean;
    iosDeviceAppInstalled?: Map<string, boolean>;
}

export const LYNX_GO_PACKAGE = 'com.sigx.lynxgo';

/**
 * Resolve `adb` by probing a few candidate paths. Many machines have
 * `ANDROID_HOME` exported but don't put `$ANDROID_HOME/platform-tools` on
 * `PATH`, so a bare `adb` lookup fails even though the SDK is installed.
 * Cached for the process lifetime — invalidating buys nothing since the
 * SDK location doesn't change mid-run.
 */
let _resolvedAdb: string | null | undefined;
export function resolveAdb(): string | null {
    if (_resolvedAdb !== undefined) return _resolvedAdb;
    const home = process.env.HOME ?? '';
    const candidates = [
        'adb',
        process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : null,
        process.env.ANDROID_SDK_ROOT ? join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb') : null,
        process.platform === 'darwin' && home
            ? join(home, 'Library/Android/sdk/platform-tools/adb')
            : null,
        process.platform === 'linux' && home
            ? join(home, 'Android/Sdk/platform-tools/adb')
            : null,
    ].filter((c): c is string => !!c);
    for (const candidate of candidates) {
        try {
            execSync(`"${candidate}" version`, { stdio: 'pipe' });
            _resolvedAdb = candidate;
            return candidate;
        } catch {
            // try next
        }
    }
    _resolvedAdb = null;
    return null;
}

function adbCmd(): string {
    return resolveAdb() ?? 'adb';
}

/**
 * Check if ADB is available on the system.
 */
export function isAdbAvailable(): boolean {
    return resolveAdb() !== null;
}

/**
 * List connected Android devices via ADB.
 */
export function listAndroidDevices(): AndroidDevice[] {
    try {
        const output = execSync(`"${adbCmd()}" devices -l`, { stdio: 'pipe', encoding: 'utf-8' });
        const lines = output.split('\n').slice(1); // Skip header

        return lines
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => {
                const parts = line.split(/\s+/);
                const id = parts[0];
                const state = parts[1];

                // Extract model from the key-value pairs
                const modelMatch = line.match(/model:(\S+)/);
                const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : undefined;

                return {
                    id,
                    type: id.includes('emulator') || id.startsWith('localhost')
                        ? 'emulator' as const
                        : state === 'offline'
                            ? 'offline' as const
                            : 'device' as const,
                    model,
                };
            })
            .filter((d) => d.type !== 'offline');
    } catch {
        return [];
    }
}

/**
 * Check if sigx-lynx-go is installed on a specific device.
 */
export function isLynxGoInstalled(deviceId: string): boolean {
    try {
        const output = execSync(`"${adbCmd()}" -s ${deviceId} shell pm list packages ${LYNX_GO_PACKAGE}`, {
            stdio: 'pipe',
            encoding: 'utf-8',
        });
        return output.includes(LYNX_GO_PACKAGE);
    } catch {
        return false;
    }
}

/**
 * Launch sigx-lynx-go on a device with a specific URL.
 */
export function launchLynxGo(deviceId: string, url: string): boolean {
    try {
        execSync(
            `"${adbCmd()}" -s ${deviceId} shell am start -a android.intent.action.VIEW -d "sigx-lynx-go://open?url=${encodeURIComponent(url)}" ${LYNX_GO_PACKAGE}`,
            { stdio: 'pipe' },
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a specific app (by applicationId) is installed on a device.
 */
export function isAppInstalled(deviceId: string, applicationId: string): boolean {
    try {
        const output = execSync(`"${adbCmd()}" -s ${deviceId} shell pm list packages ${applicationId}`, {
            stdio: 'pipe',
            encoding: 'utf-8',
        });
        return output.includes(applicationId);
    } catch {
        return false;
    }
}

/**
 * Forward `localhost:<port>` on the device to `localhost:<port>` on the host.
 * Safe on both physical devices and emulators; the port-forward makes
 * `http://localhost:<port>` reachable from the app regardless of the network
 * the device is on (or lack thereof — USB-only is fine).
 */
export function adbReverse(deviceId: string, port: number): boolean {
    try {
        execSync(`"${adbCmd()}" -s ${deviceId} reverse tcp:${port} tcp:${port}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Force-stop an app on a device. Android equivalent of `xcrun simctl
 * terminate` — used before a dev relaunch so the next `am start` goes
 * through `onCreate` with the fresh `sigx_dev_url` extra instead of
 * `onNewIntent` on a stale `singleTop` instance.
 */
export function forceStopApp(deviceId: string, packageName: string): void {
    try {
        execSync(`"${adbCmd()}" -s ${deviceId} shell am force-stop ${packageName}`, { stdio: 'pipe' });
    } catch {
        // App may not be running — ignore, parity with the iOS simctl terminate path.
    }
}

/**
 * Launch a custom app on a device, optionally with a dev server URL via
 * intent extra. Pass an empty `devUrl` for sandbox-style launches (no URL,
 * no extra) — Android's shell command parser rejects `--es key ""`.
 */
export function launchApp(deviceId: string, applicationId: string, devUrl: string): boolean {
    try {
        const base = `"${adbCmd()}" -s ${deviceId} shell am start -n ${applicationId}/${applicationId}.MainActivity`;
        const cmd = devUrl ? `${base} --es sigx_dev_url "${devUrl}"` : base;
        execSync(cmd, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// ────────────────────────────────────────────────────────────────
// iOS Simulator detection
// ────────────────────────────────────────────────────────────────

/**
 * Check if xcrun simctl is available (macOS only).
 */
export function isXcrunAvailable(): boolean {
    if (process.platform !== 'darwin') return false;
    try {
        execSync('xcrun simctl help', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * List booted iOS simulators via xcrun simctl.
 */
export function listBootedSimulators(): IosSimulator[] {
    try {
        const output = execSync('xcrun simctl list devices booted -j', {
            stdio: 'pipe',
            encoding: 'utf-8',
        });
        const json = JSON.parse(output);
        const simulators: IosSimulator[] = [];

        for (const [runtime, devices] of Object.entries(json.devices as Record<string, any[]>)) {
            for (const device of devices) {
                if (device.state === 'Booted') {
                    simulators.push({
                        udid: device.udid,
                        name: device.name,
                        state: device.state,
                        runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', ''),
                    });
                }
            }
        }

        return simulators;
    } catch {
        return [];
    }
}

/**
 * List all available iOS simulators (booted and shutdown).
 */
export function listAllSimulators(): IosSimulator[] {
    try {
        const output = execSync('xcrun simctl list devices available -j', {
            stdio: 'pipe',
            encoding: 'utf-8',
        });
        const json = JSON.parse(output);
        const simulators: IosSimulator[] = [];

        for (const [runtime, devices] of Object.entries(json.devices as Record<string, any[]>)) {
            for (const device of devices) {
                if (device.isAvailable) {
                    simulators.push({
                        udid: device.udid,
                        name: device.name,
                        state: device.state,
                        runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', ''),
                    });
                }
            }
        }

        return simulators;
    } catch {
        return [];
    }
}

/**
 * Resolve the best iOS simulator to use.
 *
 * Priority:
 * 1. Already-booted simulator (matching preferredName if given)
 * 2. Available simulator matching preferredName
 * 3. First available iPhone simulator (preferring latest runtime)
 *
 * Returns null if no simulators are available.
 */
export function resolveIosSimulator(preferredName?: string): IosSimulator | null {
    // Check booted simulators first
    const booted = listBootedSimulators();
    if (booted.length > 0) {
        if (preferredName) {
            const match = booted.find(s => s.name === preferredName);
            if (match) return match;
        }
        // Return first booted iPhone, or first booted anything
        return booted.find(s => s.name.includes('iPhone')) ?? booted[0];
    }

    // No booted simulators — pick from all available
    const all = listAllSimulators();
    if (all.length === 0) return null;

    // Try preferred name
    if (preferredName) {
        const match = all.find(s => s.name === preferredName);
        if (match) return match;
    }

    // Pick the first iPhone (list is ordered by runtime, latest first)
    return all.find(s => s.name.includes('iPhone')) ?? all[0];
}

/**
 * Boot an iOS simulator by UDID. No-op if already booted.
 */
export function bootSimulator(udid: string): boolean {
    try {
        execSync(`xcrun simctl boot "${udid}"`, { stdio: 'pipe' });
        return true;
    } catch {
        // Already booted or other error
        return false;
    }
}

/**
 * Check if an app is installed on an iOS simulator.
 */
export function isAppInstalledOnSimulator(udid: string, bundleId: string): boolean {
    try {
        execSync(`xcrun simctl get_app_container ${udid} ${bundleId}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Install an app (.app bundle) on an iOS simulator.
 */
export function installAppOnSimulator(udid: string, appPath: string): boolean {
    try {
        execSync(`xcrun simctl install "${udid}" "${appPath}"`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Find the built .app in DerivedData for a given scheme.
 * `target` selects the simulator or device SDK build products directory.
 */
export function findBuiltApp(
    scheme: string,
    target: 'simulator' | 'device' = 'simulator',
    configuration: 'Debug' | 'Release' = 'Debug',
): string | null {
    try {
        const home = process.env.HOME ?? '';
        const suffix = target === 'device' ? 'iphoneos' : 'iphonesimulator';
        const productDir = `${configuration}-${suffix}`;
        const output = execSync(
            `find "${home}/Library/Developer/Xcode/DerivedData" -path "*${scheme}*/Build/Products/${productDir}/${scheme}.app" -maxdepth 6 2>/dev/null | head -1`,
            { stdio: 'pipe', encoding: 'utf-8' },
        ).trim();
        return output || null;
    } catch {
        return null;
    }
}

/**
 * Launch an app on an iOS simulator with optional dev URL.
 */
export function launchIosApp(udid: string, bundleId: string, devUrl?: string): boolean {
    try {
        const args = ['simctl', 'launch', udid, bundleId];
        if (devUrl) {
            args.push('--sigx_dev_url', devUrl);
        }
        execSync(`xcrun ${args.map(a => `"${a}"`).join(' ')}`, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// ────────────────────────────────────────────────────────────────
// Physical iOS device (devicectl) — requires Xcode 15+
// ────────────────────────────────────────────────────────────────

function runDevicectlJson<T = unknown>(args: string[]): T | null {
    const out = join(tmpdir(), `sigx-devicectl-${process.pid}-${Date.now()}.json`);
    try {
        execSync(`xcrun devicectl ${args.map(a => `"${a}"`).join(' ')} --json-output "${out}"`, {
            stdio: 'pipe',
        });
        const raw = readFileSync(out, 'utf-8');
        return JSON.parse(raw) as T;
    } catch {
        return null;
    } finally {
        try { unlinkSync(out); } catch { /* ignore */ }
    }
}

/**
 * Check if xcrun devicectl is available (Xcode 15+ on macOS).
 */
export function isDevicectlAvailable(): boolean {
    if (process.platform !== 'darwin') return false;
    try {
        execSync('xcrun devicectl --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

interface DevicectlDeviceEntry {
    identifier?: string;
    deviceProperties?: { name?: string; osVersionNumber?: string };
    hardwareProperties?: { marketingName?: string; udid?: string; platform?: string };
    connectionProperties?: { pairingState?: string; transportType?: string; tunnelState?: string };
}

/**
 * List connected (paired + available) physical iOS devices.
 * Filters out simulators, unpaired devices, and non-iOS platforms.
 */
export function listConnectedIosDevices(): IosDevice[] {
    const json = runDevicectlJson<{ result?: { devices?: DevicectlDeviceEntry[] } }>([
        'list', 'devices',
    ]);
    const entries = json?.result?.devices ?? [];

    return entries
        .filter((d) => {
            const platform = d.hardwareProperties?.platform;
            const pairing = d.connectionProperties?.pairingState;
            return platform === 'iOS' && pairing === 'paired' && !!d.identifier;
        })
        .map((d) => ({
            udid: d.identifier!,
            name: d.deviceProperties?.name ?? 'iPhone',
            model: d.hardwareProperties?.marketingName,
            osVersion: d.deviceProperties?.osVersionNumber,
            transport: d.connectionProperties?.transportType,
        }));
}

/**
 * Check if a bundle is installed on a physical iOS device.
 */
export function isAppInstalledOnDevice(udid: string, bundleId: string): boolean {
    const json = runDevicectlJson<{ result?: { apps?: Array<{ bundleIdentifier?: string }> } }>([
        'device', 'info', 'apps', '--device', udid,
    ]);
    const apps = json?.result?.apps ?? [];
    return apps.some((a) => a.bundleIdentifier === bundleId);
}

/**
 * Install an .app bundle on a physical iOS device.
 * Returns true on success, false on failure (e.g., provisioning).
 */
export function installAppOnDevice(udid: string, appPath: string): boolean {
    try {
        execSync(
            `xcrun devicectl device install app --device "${udid}" "${appPath}"`,
            { stdio: 'pipe' },
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * Launch an app on a physical iOS device with optional dev URL.
 * Terminates any existing instance so launch args refresh.
 */
export function launchAppOnDevice(udid: string, bundleId: string, devUrl?: string): boolean {
    try {
        const parts = [
            'xcrun', 'devicectl', 'device', 'process', 'launch',
            '--device', `"${udid}"`,
            '--terminate-existing',
            `"${bundleId}"`,
        ];
        if (devUrl) {
            // Positional command-line arguments come after bundle id.
            parts.push('--sigx_dev_url', `"${devUrl}"`);
        }
        execSync(parts.join(' '), { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// ────────────────────────────────────────────────────────────────
// Combined status
// ────────────────────────────────────────────────────────────────

/**
 * Get full device status: Android devices, iOS simulators, installation status.
 */
export function getDeviceStatus(appId?: string, iosBundleId?: string): DeviceStatus {
    // Android
    const adbAvailable = isAdbAvailable();
    let devices: AndroidDevice[] = [];
    const lynxGoInstalled = new Map<string, boolean>();
    const appInstalled = new Map<string, boolean>();

    if (adbAvailable) {
        devices = listAndroidDevices();
        for (const device of devices) {
            lynxGoInstalled.set(device.id, isLynxGoInstalled(device.id));
            if (appId) {
                appInstalled.set(device.id, isAppInstalled(device.id, appId));
            }
        }
    }

    // iOS simulators
    const xcrunAvailable = isXcrunAvailable();
    let iosSimulators: IosSimulator[] = [];
    const iosAppInstalled = new Map<string, boolean>();

    if (xcrunAvailable) {
        iosSimulators = listBootedSimulators();
        if (iosBundleId) {
            for (const sim of iosSimulators) {
                iosAppInstalled.set(sim.udid, isAppInstalledOnSimulator(sim.udid, iosBundleId));
            }
        }
    }

    // iOS physical devices
    const devicectlAvailable = isDevicectlAvailable();
    let iosDevices: IosDevice[] = [];
    const iosDeviceAppInstalled = new Map<string, boolean>();

    if (devicectlAvailable) {
        iosDevices = listConnectedIosDevices();
        if (iosBundleId) {
            for (const dev of iosDevices) {
                iosDeviceAppInstalled.set(dev.udid, isAppInstalledOnDevice(dev.udid, iosBundleId));
            }
        }
    }

    return {
        devices,
        lynxGoInstalled,
        appInstalled: appId ? appInstalled : undefined,
        adbAvailable,
        iosSimulators,
        xcrunAvailable,
        iosAppInstalled: iosBundleId ? iosAppInstalled : undefined,
        iosDevices,
        devicectlAvailable,
        iosDeviceAppInstalled: iosBundleId ? iosDeviceAppInstalled : undefined,
    };
}

// ────────────────────────────────────────────────────────────────
// Cached status (for responsive TUI keystrokes)
// ────────────────────────────────────────────────────────────────

interface StatusCache {
    status: DeviceStatus;
    ts: number;
    appId?: string;
    bundleId?: string;
}
let _statusCache: StatusCache | null = null;
const STATUS_CACHE_MS = 3000;

/**
 * Cached variant of {@link getDeviceStatus}. Results are memoized for
 * {@link STATUS_CACHE_MS} milliseconds, keyed by (appId, bundleId).
 *
 * Use this for keyboard-driven TUI lookups so repeated `d`/`r` presses
 * don't re-shell `adb` and `xcrun` every time. Call
 * {@link invalidateDeviceStatusCache} after an install/launch that changes
 * observable state.
 */
export function getDeviceStatusCached(appId?: string, iosBundleId?: string): DeviceStatus {
    const now = Date.now();
    if (
        _statusCache &&
        _statusCache.appId === appId &&
        _statusCache.bundleId === iosBundleId &&
        now - _statusCache.ts < STATUS_CACHE_MS
    ) {
        return _statusCache.status;
    }
    const status = getDeviceStatus(appId, iosBundleId);
    _statusCache = { status, ts: now, appId, bundleId: iosBundleId };
    return status;
}

export function invalidateDeviceStatusCache(): void {
    _statusCache = null;
}
