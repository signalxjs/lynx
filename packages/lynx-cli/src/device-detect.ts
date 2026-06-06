/**
 * Device detection utilities.
 *
 * Detects connected Android devices/emulators via ADB and iOS simulators
 * via xcrun simctl. Checks whether sigx-lynx-go or custom apps are installed.
 * Used by the dev server to show device status and optionally auto-launch.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
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
            execSync(`"${candidate}" version`, { stdio: 'pipe', timeout: 10_000 });
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
 * Parse a timeout override from the environment, falling back to `fallback`
 * unless the value is a finite, strictly-positive number. This matters: a
 * misconfigured `SIGX_*_TIMEOUT_MS=-1` (or a non-numeric value) must not slip
 * through and disable the guard — that would reintroduce the original
 * hang-forever failure mode these timeouts exist to prevent.
 */
export function envTimeoutMs(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Hard timeout for a single device *probe* (`adb`/`xcrun` calls that just
 * read state — list devices, is-installed, ping). A wedged `adbd`, a
 * half-connected USB device, or an unresponsive simulator service makes these
 * block forever; without a timeout `execSync` waits indefinitely and the dev
 * flow stalls silently right after "prebuild complete" (the symptom this
 * guards against). Override with `SIGX_DEVICE_TIMEOUT_MS` on slow links.
 */
export const DEVICE_CMD_TIMEOUT_MS = envTimeoutMs('SIGX_DEVICE_TIMEOUT_MS', 10_000);

/**
 * Hard timeout for a device *action* (boot a simulator, install an app).
 * These legitimately take far longer than a probe, so a tight bound would
 * false-fail a slow-but-progressing install. We only want to break a true
 * wedge. Override with `SIGX_DEVICE_ACTION_TIMEOUT_MS`.
 */
export const DEVICE_ACTION_TIMEOUT_MS = envTimeoutMs('SIGX_DEVICE_ACTION_TIMEOUT_MS', 180_000);

/** Which underlying tool a command drives — selects the recovery hint. */
type DeviceTool = 'adb' | 'simctl' | 'devicectl';

const TOOL_META: Record<DeviceTool, { label: string; hint: string }> = {
    adb: {
        label: 'The adb server',
        hint: 'replug USB, toggle USB debugging, or run `adb kill-server && adb start-server`',
    },
    simctl: {
        label: 'The iOS simulator service',
        hint: 'the simulator may be wedged — try `xcrun simctl shutdown all`, reboot the Simulator app, or restart Xcode',
    },
    devicectl: {
        label: 'Xcode devicectl',
        hint: 'the device may be unresponsive — reconnect it, confirm it is unlocked & trusted, or restart Xcode',
    },
};

/** Warn keys we've already emitted, so the dev loop's repeated probes don't
 *  spam the same "not responding" message every few seconds. */
const _warnedUnresponsive = new Set<string>();

export interface DeviceExecResult {
    /** Command exited 0. */
    ok: boolean;
    /** stdout (empty string unless ok). */
    stdout: string;
    /** Command was killed by the timeout — the device/daemon is wedged. */
    timedOut: boolean;
}

interface ExecToolOpts {
    /** Tool being driven — selects the recovery hint in the timeout warning. */
    tool: DeviceTool;
    /** Identifier for the warning + dedup. This is also the device selector
     *  (`-s <id>` / `--device <udid>`) interpolated into `cmd`, so when set it
     *  is validated against {@link SAFE_DEVICE_ID} before the command runs.
     *  Omit for daemon-wide calls; the tool name is used for the warning. */
    key?: string;
    /** Timeout in ms. Defaults to the probe timeout; pass
     *  {@link DEVICE_ACTION_TIMEOUT_MS} for installs/boots. */
    timeout?: number;
}

/**
 * Characters legal in an adb serial or an iOS udid — alphanumerics plus the
 * separators they actually use (`.`, `_`, `:`, `-`). We build device commands
 * as shell strings (some need `|`, redirects, or `--json-output`), so any id
 * interpolated as the `-s`/`--device` selector is validated against this first
 * to close the shell-injection surface (Copilot review, PR #134).
 */
const SAFE_DEVICE_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * Render a timeout for the warning message at the granularity it was
 * configured: sub-second budgets (e.g. the 750ms reverse-remove) show as
 * `750ms`, second-scale ones as `10s` / `1.5s`. Avoids both under-reporting
 * (rounding 750ms down to `0s`) and over-reporting (ceiling it to `1s`).
 */
function formatTimeout(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${ms / 1000}s`;
}

/**
 * Run a device command with a hard timeout and classify the outcome. On
 * timeout we emit a one-time, tool-appropriate, actionable warning (keyed by
 * `key`) instead of failing silently. Ordinary non-zero exits (e.g. an
 * offline device that errors quickly) return `{ ok:false, timedOut:false }`
 * with no warning — callers treat those as "not installed", same as before.
 */
function execTool(cmd: string, { tool, key, timeout = DEVICE_CMD_TIMEOUT_MS }: ExecToolOpts): DeviceExecResult {
    const warnKey = key ?? tool;
    // The id is interpolated into a shell command — reject anything that
    // isn't a plain serial/udid rather than hand it to the shell.
    if (key !== undefined && !SAFE_DEVICE_ID.test(key)) {
        process.stderr.write(
            `\x1b[33m⚠ Refusing ${tool} command for unsafe device identifier: ${JSON.stringify(key)}\x1b[0m\n`,
        );
        return { ok: false, stdout: '', timedOut: false };
    }
    try {
        const stdout = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', timeout });
        return { ok: true, stdout, timedOut: false };
    } catch (err) {
        // On timeout execSync throws with `code: 'ETIMEDOUT'`; a normal
        // command failure has a numeric `status` and no `code`. Key strictly
        // off ETIMEDOUT — the kill signal alone is `SIGTERM`, which a child can
        // also receive for non-timeout reasons, so matching on it would
        // misclassify those as "stopped responding".
        const e = err as { code?: string };
        const timedOut = e?.code === 'ETIMEDOUT';
        if (timedOut && !_warnedUnresponsive.has(warnKey)) {
            _warnedUnresponsive.add(warnKey);
            const { label, hint } = TOOL_META[tool];
            const who = key && key !== tool ? `Device ${key}` : label;
            process.stderr.write(
                `\x1b[33m⚠ ${who} stopped responding (timed out after ` +
                `${formatTimeout(timeout)}) — ${hint}.\x1b[0m\n`,
            );
        }
        return { ok: false, stdout: '', timedOut };
    }
}

/** adb-specialized shorthand for {@link execTool}. */
function execDevice(cmd: string, deviceKey: string, timeout?: number): DeviceExecResult {
    return execTool(cmd, { tool: 'adb', key: deviceKey === 'adb' ? undefined : deviceKey, timeout });
}

/**
 * Fast liveness probe for a single Android device. Returns `responsive:false`
 * when the device is wedged (adb shell times out) so callers can fail fast
 * with a clear message instead of marching into a `gradle installDebug` that
 * would block on the same dead connection.
 */
export function pingDevice(deviceId: string): { responsive: boolean; timedOut: boolean } {
    const res = execDevice(`"${adbCmd()}" -s ${deviceId} shell true`, deviceId);
    return { responsive: res.ok, timedOut: res.timedOut };
}

/** Clear the "already warned" set — useful in tests and after a successful
 *  reconnect so a later genuine hang warns again. */
export function resetDeviceWarnings(): void {
    _warnedUnresponsive.clear();
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
    const res = execDevice(`"${adbCmd()}" devices -l`, 'adb');
    if (!res.ok) return [];
    const lines = res.stdout.split('\n').slice(1); // Skip header

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
}

/**
 * Resolve a running emulator's AVD name (e.g. `Pixel_7`) by querying its
 * console. The ADB serial (`emulator-5554`) doesn't carry the AVD name on
 * its own, so we ask the emulator. Returns null when the serial isn't an
 * emulator or the query fails.
 */
export function getRunningAvdName(serial: string): string | null {
    const res = execDevice(`"${adbCmd()}" -s ${serial} emu avd name`, serial);
    if (!res.ok) return null;
    // Output is "<AvdName>\nOK\n" on success. The first non-empty line
    // before "OK" is the AVD name.
    for (const line of res.stdout.split('\n').map((l) => l.trim())) {
        if (!line || line === 'OK') continue;
        return line;
    }
    return null;
}

/**
 * Check if sigx-lynx-go is installed on a specific device.
 */
export function isLynxGoInstalled(deviceId: string): boolean {
    const res = execDevice(`"${adbCmd()}" -s ${deviceId} shell pm list packages ${LYNX_GO_PACKAGE}`, deviceId);
    return res.ok && res.stdout.includes(LYNX_GO_PACKAGE);
}

/**
 * Launch sigx-lynx-go on a device with a specific URL.
 */
export function launchLynxGo(deviceId: string, url: string): boolean {
    return execDevice(
        `"${adbCmd()}" -s ${deviceId} shell am start -a android.intent.action.VIEW -d "sigx-lynx-go://open?url=${encodeURIComponent(url)}" ${LYNX_GO_PACKAGE}`,
        deviceId,
    ).ok;
}

/**
 * Check if a specific app (by applicationId) is installed on a device.
 */
export function isAppInstalled(deviceId: string, applicationId: string): boolean {
    const res = execDevice(`"${adbCmd()}" -s ${deviceId} shell pm list packages ${applicationId}`, deviceId);
    return res.ok && res.stdout.includes(applicationId);
}

/**
 * Forward `localhost:<port>` on the device to `localhost:<port>` on the host.
 * Safe on both physical devices and emulators; the port-forward makes
 * `http://localhost:<port>` reachable from the app regardless of the network
 * the device is on (or lack thereof — USB-only is fine).
 */
export function adbReverse(deviceId: string, port: number): boolean {
    return execDevice(`"${adbCmd()}" -s ${deviceId} reverse tcp:${port} tcp:${port}`, deviceId).ok;
}

/**
 * Tear down a forward created by {@link adbReverse}. Called on dev-server
 * shutdown so we don't leave a stale `tcp:<port>` mapping lingering on the
 * device's adbd after the server is gone. Best-effort: it runs synchronously
 * on the exit path (once per forwarded device), so it uses a deliberately tiny
 * timeout — a healthy device removes a forward in milliseconds, and we'd
 * rather skip cleanup on a wedged device than delay Ctrl+C. Override with
 * `SIGX_REVERSE_REMOVE_TIMEOUT_MS`.
 */
export const REVERSE_REMOVE_TIMEOUT_MS = envTimeoutMs('SIGX_REVERSE_REMOVE_TIMEOUT_MS', 750);
export function adbReverseRemove(deviceId: string, port: number): boolean {
    return execDevice(
        `"${adbCmd()}" -s ${deviceId} reverse --remove tcp:${port}`,
        deviceId,
        REVERSE_REMOVE_TIMEOUT_MS,
    ).ok;
}

/**
 * Force-stop an app on a device. Android equivalent of `xcrun simctl
 * terminate` — used before a dev relaunch so the next `am start` goes
 * through `onCreate` with the fresh `sigx_dev_url` extra instead of
 * `onNewIntent` on a stale `singleTop` instance.
 */
export function forceStopApp(deviceId: string, packageName: string): void {
    // App may not be running — failure/timeout is ignored, parity with the
    // iOS simctl terminate path. (A timeout still surfaces its own warning.)
    execDevice(`"${adbCmd()}" -s ${deviceId} shell am force-stop ${packageName}`, deviceId);
}

/**
 * Launch a custom app on a device, optionally with a dev server URL via
 * intent extra. Pass an empty `devUrl` for sandbox-style launches (no URL,
 * no extra) — Android's shell command parser rejects `--es key ""`.
 */
export function launchApp(deviceId: string, applicationId: string, devUrl: string): boolean {
    const base = `"${adbCmd()}" -s ${deviceId} shell am start -n ${applicationId}/${applicationId}.MainActivity`;
    const cmd = devUrl ? `${base} --es sigx_dev_url "${devUrl}"` : base;
    return execDevice(cmd, deviceId).ok;
}

// ────────────────────────────────────────────────────────────────
// iOS Simulator detection
// ────────────────────────────────────────────────────────────────

/**
 * Check if xcrun simctl is available (macOS only).
 */
export function isXcrunAvailable(): boolean {
    if (process.platform !== 'darwin') return false;
    return execTool('xcrun simctl help', { tool: 'simctl' }).ok;
}

/**
 * List booted iOS simulators via xcrun simctl.
 */
export function listBootedSimulators(): IosSimulator[] {
    try {
        const res = execTool('xcrun simctl list devices booted -j', { tool: 'simctl' });
        if (!res.ok) return [];
        const json = JSON.parse(res.stdout);
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
        const res = execTool('xcrun simctl list devices available -j', { tool: 'simctl' });
        if (!res.ok) return [];
        const json = JSON.parse(res.stdout);
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
    // Booting a cold simulator can legitimately take tens of seconds — use the
    // longer action timeout so we don't false-fail a slow boot, only a wedge.
    return execTool(`xcrun simctl boot "${udid}"`, {
        tool: 'simctl',
        key: udid,
        timeout: DEVICE_ACTION_TIMEOUT_MS,
    }).ok;
}

/**
 * Resolve the installed .app container path for a bundle id on a simulator.
 * Returns the on-host filesystem path (simulator containers live under
 * `~/Library/Developer/CoreSimulator/...`), or null when not installed.
 */
export function getInstalledAppContainer(udid: string, bundleId: string): string | null {
    // Interpolated into a shell command — same guard as device ids
    // (SAFE_DEVICE_ID covers the bundle-id charset: alnum, `.`, `-`).
    if (!SAFE_DEVICE_ID.test(bundleId)) {
        process.stderr.write(
            `\x1b[33m⚠ Refusing simctl command for unsafe bundle identifier: ${JSON.stringify(bundleId)}\x1b[0m\n`,
        );
        return null;
    }
    const res = execTool(`xcrun simctl get_app_container ${udid} ${bundleId}`, {
        tool: 'simctl',
        key: udid,
    });
    if (!res.ok) return null;
    return res.stdout.trim() || null;
}

/**
 * Check if an app is installed on an iOS simulator.
 */
export function isAppInstalledOnSimulator(udid: string, bundleId: string): boolean {
    return getInstalledAppContainer(udid, bundleId) !== null;
}

/**
 * Install an app (.app bundle) on an iOS simulator.
 */
export function installAppOnSimulator(udid: string, appPath: string): boolean {
    return execTool(`xcrun simctl install "${udid}" "${appPath}"`, {
        tool: 'simctl',
        key: udid,
        timeout: DEVICE_ACTION_TIMEOUT_MS,
    }).ok;
}

/**
 * Project-local derived-data directory all sigx xcodebuild invocations write
 * into (`xcodebuild -derivedDataPath`). Keeping build products inside the
 * checkout (the RN/Expo approach) means two checkouts of the same app —
 * identical scheme + bundle id — can never pick up each other's .app, which
 * the old shared-`~/Library/Developer/Xcode/DerivedData` glob did (#178).
 */
export function iosDerivedDataPath(cwd: string): string {
    return join(cwd, 'ios', 'build');
}

/**
 * Resolve the built .app for a scheme inside THIS project's derived-data dir
 * ({@link iosDerivedDataPath}). Purely deterministic path resolution — no
 * DerivedData globbing — so it returns this checkout's products or null.
 * `target` selects the simulator or device SDK build products directory.
 */
export function findBuiltApp(
    cwd: string,
    scheme: string,
    target: 'simulator' | 'device' = 'simulator',
    configuration: 'Debug' | 'Release' = 'Debug',
): string | null {
    const suffix = target === 'device' ? 'iphoneos' : 'iphonesimulator';
    const appPath = join(
        iosDerivedDataPath(cwd),
        'Build', 'Products', `${configuration}-${suffix}`, `${scheme}.app`,
    );
    return existsSync(appPath) ? appPath : null;
}

/**
 * Launch an app on an iOS simulator with optional dev URL.
 */
export function launchIosApp(udid: string, bundleId: string, devUrl?: string): boolean {
    const args = ['simctl', 'launch', udid, bundleId];
    if (devUrl) {
        args.push('--sigx_dev_url', devUrl);
    }
    return execTool(`xcrun ${args.map(a => `"${a}"`).join(' ')}`, { tool: 'simctl', key: udid }).ok;
}

// ────────────────────────────────────────────────────────────────
// Physical iOS device (devicectl) — requires Xcode 15+
// ────────────────────────────────────────────────────────────────

function runDevicectlJson<T = unknown>(args: string[], deviceKey?: string): T | null {
    const out = join(tmpdir(), `sigx-devicectl-${process.pid}-${Date.now()}.json`);
    try {
        const res = execTool(
            `xcrun devicectl ${args.map(a => `"${a}"`).join(' ')} --json-output "${out}"`,
            { tool: 'devicectl', key: deviceKey },
        );
        if (!res.ok) return null;
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
    return execTool('xcrun devicectl --version', { tool: 'devicectl' }).ok;
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
    ], udid);
    const apps = json?.result?.apps ?? [];
    return apps.some((a) => a.bundleIdentifier === bundleId);
}

/**
 * Install an .app bundle on a physical iOS device.
 * Returns true on success, false on failure (e.g., provisioning).
 */
export function installAppOnDevice(udid: string, appPath: string): boolean {
    return execTool(
        `xcrun devicectl device install app --device "${udid}" "${appPath}"`,
        { tool: 'devicectl', key: udid, timeout: DEVICE_ACTION_TIMEOUT_MS },
    ).ok;
}

/**
 * Launch an app on a physical iOS device with optional dev URL.
 * Terminates any existing instance so launch args refresh.
 */
export function launchAppOnDevice(udid: string, bundleId: string, devUrl?: string): boolean {
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
    return execTool(parts.join(' '), { tool: 'devicectl', key: udid }).ok;
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
