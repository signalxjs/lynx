/**
 * Enhanced dev server for Lynx projects.
 *
 * Wraps rspeedy with sigx-specific DX features:
 * - Branded banner with project info
 * - LAN IP detection + QR code for sigx-lynx-go
 * - Device detection (ADB)
 * - Keyboard shortcuts (r = reload, q = quit, etc.)
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { getAllLanIPs } from './network.js';
import { generateQR } from './qr.js';
import { getDeviceStatus, getDeviceStatusCached, invalidateDeviceStatusCache, launchLynxGo, launchApp, launchIosApp, launchAppOnDevice, installAppOnDevice, resolveIosSimulator, bootSimulator, listAllSimulators, installAppOnSimulator, findBuiltApp, adbReverse, forceStopApp, LYNX_GO_PACKAGE, type DeviceStatus } from './device-detect.js';
import { runWithBuildFilter } from './build-output.js';
import type { Logger } from '@sigx/cli/plugin';
import type { SelectedTarget } from './target-picker.js';
import { parseDeviceLogLine, formatDeviceLogLine, LOG_SENTINEL } from './device-log.js';

export interface DevServerOptions {
    cwd: string;
    port?: string | number;
    host?: boolean;
    logger: Logger;
    /** If set, auto-launch this Android app (by applicationId) with the dev URL instead of sigx-lynx-go */
    launchAppId?: string;
    /** If set, auto-launch this iOS app (by bundleId) on booted simulators */
    launchBundleId?: string;
    /** iOS simulator name (for build + launch shortcut) */
    iosSimulatorName?: string;
    /**
     * Explicit target list from the picker / flags. When provided, the
     * banner and auto-launch loop use this instead of scanning the whole
     * system — so the banner only shows platforms the user chose and
     * auto-launch fires only on those targets.
     */
    selectedTargets?: SelectedTarget[];
    /** Stream raw build output (xcodebuild / gradle) instead of filtering. */
    verbose?: boolean;
    /**
     * Suppress device JS console log streaming in the terminal. Sentinel
     * lines from the plugin are still parsed, just not printed.
     */
    disableDeviceLogs?: boolean;
}

function getProjectName(cwd: string): string {
    try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
        return pkg.name || 'sigx-lynx';
    } catch {
        return 'sigx-lynx';
    }
}

function formatDeviceStatus(status: DeviceStatus, appId?: string, bundleId?: string): string[] {
    const lines: string[] = [];

    // Android
    if (!status.adbAvailable) {
        lines.push('  Android:  \x1b[2m⚠ adb not found\x1b[0m');
    } else if (status.devices.length === 0) {
        lines.push('  Android:  — no devices connected');
    } else {
        for (const device of status.devices) {
            const icon = device.type === 'emulator' ? '📱' : '📲';
            const name = device.model || device.id;

            const statusParts: string[] = [];
            if (appId && status.appInstalled?.get(device.id)) {
                statusParts.push(`✓ ${appId}`);
            }
            if (status.lynxGoInstalled.get(device.id)) {
                statusParts.push('✓ sigx-lynx-go');
            }
            if (statusParts.length === 0) {
                statusParts.push('✗ no sigx app installed');
            }

            lines.push(`  ${icon} ${name} (${device.id})`);
            lines.push(`     ${statusParts.join(' · ')}`);
        }
    }

    // iOS
    if (!status.xcrunAvailable) {
        // Only show iOS status on macOS
        if (process.platform === 'darwin') {
            lines.push('  iOS:      \x1b[2m⚠ xcrun not found\x1b[0m');
        }
    } else if (status.iosSimulators.length === 0 && status.iosDevices.length === 0) {
        lines.push('  iOS:      — no simulators booted, no devices connected');
    } else {
        for (const sim of status.iosSimulators) {
            const statusParts: string[] = [];
            if (bundleId && status.iosAppInstalled?.get(sim.udid)) {
                statusParts.push(`✓ ${bundleId}`);
            }
            if (statusParts.length === 0) {
                statusParts.push('✗ app not installed');
            }

            lines.push(`  📱 ${sim.name} (${sim.runtime})`);
            lines.push(`     ${statusParts.join(' · ')}`);
        }

        for (const dev of status.iosDevices) {
            const statusParts: string[] = [];
            if (bundleId && status.iosDeviceAppInstalled?.get(dev.udid)) {
                statusParts.push(`✓ ${bundleId}`);
            }
            if (statusParts.length === 0) {
                statusParts.push('✗ app not installed');
            }
            const desc = dev.model
                ? `${dev.name} · ${dev.model}${dev.osVersion ? ` · iOS ${dev.osVersion}` : ''}`
                : dev.name;
            const transport = dev.transport ? ` [${dev.transport}]` : '';
            lines.push(`  📲 ${desc}${transport}`);
            lines.push(`     ${statusParts.join(' · ')}`);
        }
    }

    return lines;
}

function formatSelectedTargets(targets: SelectedTarget[]): string[] {
    if (targets.length === 0) {
        return ['  \x1b[2m(no targets — waiting for a manual client)\x1b[0m'];
    }
    const lines: string[] = [];
    const ios = targets.filter((t) => t.kind === 'ios-simulator' || t.kind === 'ios-device');
    const android = targets.filter((t) => t.kind === 'android-device');
    if (ios.length > 0) {
        lines.push('  iOS:');
        for (const t of ios) {
            const icon = t.kind === 'ios-simulator' ? '📱' : '📲';
            lines.push(`    ${icon} ${t.name}`);
        }
    }
    if (android.length > 0) {
        lines.push('  Android:');
        for (const t of android) {
            if (t.kind !== 'android-device') continue;
            const name = t.model || t.deviceId;
            lines.push(`    📱 ${name} (${t.deviceId})`);
        }
    }
    return lines;
}

function printBanner(opts: {
    projectName: string;
    port: number;
    lanIPs: { name: string; address: string }[];
    deviceStatus: DeviceStatus;
    appId?: string;
    bundleId?: string;
    selectedTargets?: SelectedTarget[];
}) {
    const { projectName, port, lanIPs, deviceStatus, appId, bundleId, selectedTargets } = opts;
    const localUrl = `http://localhost:${port}`;
    const bundlePath = '/main.lynx.bundle';

    const lines = [
        '',
        `  \x1b[1m⚡ sigx dev\x1b[0m · \x1b[33m${projectName}\x1b[0m`,
        '',
        `  Local:    \x1b[4m${localUrl}${bundlePath}\x1b[0m`,
    ];

    for (const { name, address } of lanIPs) {
        const url = `http://${address}:${port}${bundlePath}`;
        lines.push(`  Network:  \x1b[4m${url}\x1b[0m \x1b[2m(${name})\x1b[0m`);
    }

    lines.push('');

    // QR code for the primary bundle URL
    if (lanIPs.length > 0) {
        const primaryBundleUrl = `http://${lanIPs[0].address}:${port}${bundlePath}`;
        lines.push('  \x1b[2mScan with sigx-lynx-go:\x1b[0m');
        const qr = generateQR(primaryBundleUrl);
        for (const qrLine of qr.split('\n')) {
            lines.push(`    ${qrLine}`);
        }
    }

    // Device status
    lines.push('');
    if (selectedTargets) {
        lines.push(...formatSelectedTargets(selectedTargets));
    } else {
        lines.push(...formatDeviceStatus(deviceStatus, appId, bundleId));
    }

    // Keyboard shortcuts
    lines.push('');
    const shortcuts = 'r reload · d devices · q quit';
    const extraShortcuts = [
        appId ? 'a install+launch Android' : '',
        bundleId && process.platform === 'darwin' ? 'i build/launch iOS' : '',
    ].filter(Boolean).join(' · ');
    const shortcutLine = extraShortcuts ? `${shortcuts} · ${extraShortcuts}` : shortcuts;
    lines.push(`  \x1b[2mShortcuts: ${shortcutLine}\x1b[0m`);
    lines.push('');

    console.log(lines.join('\n'));
}

/**
 * Ask the lynx-plugin log WS server (running inside the rspeedy child) to
 * broadcast a reload to every connected device streamer. Resolves with the
 * number of clients the message reached, or 0 if the request failed for any
 * reason — the caller falls back to native relaunch in either of those cases.
 *
 * The plugin binds the log WS server on `SIGX_LYNX_DEV_PORT + 1`, which is
 * `requestedPort + 1` from the CLI's perspective. `serverState.port` can
 * drift if rsbuild's fallback kicks in after the plugin has already bound,
 * so we keep the canonical wsPort in a separate captured value.
 */
function requestJsReload(wsPort: number): Promise<number> {
    return new Promise((resolve) => {
        const req = httpRequest(
            {
                hostname: '127.0.0.1',
                port: wsPort,
                path: '/__sigx/reload',
                method: 'POST',
                // Tight timeout — we'd rather fall through to native relaunch
                // than make the user wait if the plugin process is stuck.
                timeout: 1500,
            },
            (res) => {
                let body = '';
                res.setEncoding('utf-8');
                res.on('data', (chunk: string) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) { resolve(0); return; }
                    try {
                        const parsed = JSON.parse(body) as { reloaded?: unknown };
                        const n = typeof parsed.reloaded === 'number' ? parsed.reloaded : 0;
                        resolve(n);
                    } catch {
                        resolve(0);
                    }
                });
            },
        );
        req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } resolve(0); });
        req.on('error', () => resolve(0));
        req.end();
    });
}

function setupKeyboardShortcuts(child: ChildProcess, opts: {
    cwd: string;
    serverState: { port: number };
    /** Port of the dev-client log/reload WS server (plugin-side). */
    wsPort: number;
    lanIPs: { name: string; address: string }[];
    projectName: string;
    logger: Logger;
    appId?: string;
    bundleId?: string;
    iosSimulatorName?: string;
    verbose?: boolean;
    killChildTree: (signal?: NodeJS.Signals) => void;
}) {
    if (!process.stdin.isTTY) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (key: string) => {
        const primaryIP = opts.lanIPs.length > 0 ? opts.lanIPs[0].address : null;
        const bundleUrl = primaryIP
            ? `http://${primaryIP}:${opts.serverState.port}/main.lynx.bundle`
            : `http://localhost:${opts.serverState.port}/main.lynx.bundle`;

        // Android devices reach the dev server via `adb reverse`, so their
        // per-device URL is always localhost (works over USB, Wi-Fi, or
        // no-network-at-all provided adb is connected).
        const androidUrlFor = (deviceId: string): string => {
            adbReverse(deviceId, opts.serverState.port);
            return `http://localhost:${opts.serverState.port}/main.lynx.bundle`;
        };

        switch (key) {
            case 'r':
            case 'R': {
                // Two-stage reload: first ask the plugin's WS server to push a
                // `{ type: 'reload' }` message to every connected device — the
                // dev-client reloads the LynxView in-place without a full
                // native relaunch. If no device is currently streaming logs
                // (bundle crashed, app not running, etc.), we fall through to
                // the legacy native-relaunch path below so `r` always does
                // *something* visible.
                void (async () => {
                    const reloaded = await requestJsReload(opts.wsPort);
                    if (reloaded > 0) {
                        opts.logger.log(
                            `\x1b[32m✓\x1b[0m JS reload sent to ${reloaded} device${reloaded === 1 ? '' : 's'}`,
                        );
                        return;
                    }

                    opts.logger.log(`Relaunching with ${bundleUrl}...`);
                    const status = getDeviceStatusCached(opts.appId, opts.bundleId);
                    let relaunched = 0;

                    // Android — per-device URL routes via `adb reverse`.
                    // Force-stop first so the next `am start` enters `onCreate`
                    // with a fresh intent extra; otherwise `singleTop`
                    // activities receive `onNewIntent` and silently keep the
                    // stale dev URL.
                    for (const device of status.devices) {
                        const url = androidUrlFor(device.id);
                        if (opts.appId && status.appInstalled?.get(device.id)) {
                            forceStopApp(device.id, opts.appId);
                            launchApp(device.id, opts.appId, url);
                            relaunched++;
                        } else if (status.lynxGoInstalled.get(device.id)) {
                            forceStopApp(device.id, LYNX_GO_PACKAGE);
                            launchLynxGo(device.id, url);
                            relaunched++;
                        }
                    }

                    // iOS simulators — terminate any running instance first so launch args refresh.
                    if (opts.bundleId) {
                        for (const sim of status.iosSimulators) {
                            if (status.iosAppInstalled?.get(sim.udid)) {
                                try {
                                    execSync(
                                        `xcrun simctl terminate "${sim.udid}" "${opts.bundleId}"`,
                                        { stdio: 'pipe' },
                                    );
                                } catch {
                                    // App may not be running
                                }
                                launchIosApp(sim.udid, opts.bundleId, bundleUrl);
                                relaunched++;
                            }
                        }

                        // iOS physical devices — devicectl handles termination via --terminate-existing.
                        for (const dev of status.iosDevices) {
                            if (status.iosDeviceAppInstalled?.get(dev.udid)) {
                                if (launchAppOnDevice(dev.udid, opts.bundleId, bundleUrl)) {
                                    relaunched++;
                                }
                            }
                        }
                    }

                    if (relaunched === 0) {
                        opts.logger.log('No installed devices/simulators found. Press "i" to build & install iOS or "a" for Android.');
                    }
                })();
                break;
            }
            case 'd':
            case 'D': {
                opts.logger.log('Scanning devices...');
                const status = getDeviceStatusCached(opts.appId, opts.bundleId);
                const deviceLines = formatDeviceStatus(status, opts.appId, opts.bundleId);
                console.log(deviceLines.join('\n'));

                // Auto-launch on Android devices that have the custom app or sigx-lynx-go
                for (const device of status.devices) {
                    const url = androidUrlFor(device.id);
                    if (opts.appId && status.appInstalled?.get(device.id)) {
                        opts.logger.log(`Launching ${opts.appId} on ${device.model || device.id}...`);
                        launchApp(device.id, opts.appId, url);
                    } else if (status.lynxGoInstalled.get(device.id)) {
                        opts.logger.log(`Launching sigx-lynx-go on ${device.model || device.id}...`);
                        launchLynxGo(device.id, url);
                    }
                }

                // Auto-launch on iOS simulators and devices
                if (opts.bundleId) {
                    for (const sim of status.iosSimulators) {
                        if (status.iosAppInstalled?.get(sim.udid)) {
                            opts.logger.log(`Launching on ${sim.name}...`);
                            launchIosApp(sim.udid, opts.bundleId, bundleUrl);
                        }
                    }
                    for (const dev of status.iosDevices) {
                        if (status.iosDeviceAppInstalled?.get(dev.udid)) {
                            opts.logger.log(`Launching on ${dev.name}...`);
                            launchAppOnDevice(dev.udid, opts.bundleId, bundleUrl);
                        }
                    }
                }
                break;
            }
            case 'a':
            case 'A': {
                if (!opts.appId) {
                    opts.logger.log('No custom app configured. Use `sigx run:android` first.');
                    break;
                }
                opts.logger.log('Installing and launching Android app...');
                void (async () => {
                    const androidDir = join(opts.cwd, 'android');
                    const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
                    try {
                        await runWithBuildFilter(
                            join(androidDir, gradleCmd),
                            ['installDebug'],
                            {
                                cwd: androidDir,
                                shell: process.platform === 'win32',
                            },
                            { kind: 'gradle', verbose: opts.verbose ?? false, logger: opts.logger },
                        );
                    } catch {
                        opts.logger.error('Android build failed');
                        return;
                    }
                    opts.logger.log('\x1b[32m✓ App installed\x1b[0m');

                    invalidateDeviceStatusCache();
                    const status = getDeviceStatus(opts.appId);
                    for (const device of status.devices) {
                        const url = androidUrlFor(device.id);
                        opts.logger.log(`Launching on ${device.model || device.id}...`);
                        launchApp(device.id, opts.appId!, url);
                    }
                })();
                break;
            }
            case 'q':
            case 'Q':
            case '\u0003': // Ctrl+C
                opts.logger.log('Shutting down...');
                opts.killChildTree('SIGTERM');
                setTimeout(() => process.exit(0), 500).unref();
                break;
            case 'i':
            case 'I': {
                if (!opts.bundleId || process.platform !== 'darwin') {
                    opts.logger.log('iOS shortcut requires macOS and a configured bundle id.');
                    break;
                }

                const simulator = resolveIosSimulator(opts.iosSimulatorName);
                if (!simulator) {
                    opts.logger.error('No iOS simulators available. Install simulators via Xcode → Settings → Platforms.');
                    break;
                }

                opts.logger.log(`Using simulator: ${simulator.name} (${simulator.runtime})`);

                if (simulator.state !== 'Booted') {
                    opts.logger.log(`Booting ${simulator.name}...`);
                    bootSimulator(simulator.udid);
                }

                // Open Simulator.app so the user can see it
                try { execSync('open -a Simulator', { stdio: 'pipe' }); } catch { /* ignore */ }

                // Fast path: if the app is already installed, just relaunch with the fresh URL.
                const fresh = getDeviceStatusCached(opts.appId, opts.bundleId);
                const alreadyInstalled = fresh.iosAppInstalled?.get(simulator.udid) ?? false;

                if (alreadyInstalled) {
                    opts.logger.log('App installed — terminating and relaunching with current dev URL...');
                    try {
                        execSync(`xcrun simctl terminate "${simulator.udid}" "${opts.bundleId}"`, { stdio: 'pipe' });
                    } catch { /* not running */ }
                    launchIosApp(simulator.udid, opts.bundleId, bundleUrl);
                    break;
                }

                opts.logger.log('App not installed — building...');
                void (async () => {
                    const iosDir = join(opts.cwd, 'ios');

                    // Determine app name from config (fallback to workspace listing)
                    let appName = 'app';
                    try {
                        const { loadConfig } = await import('./prebuild.js');
                        const { resolveConfig } = await import('./config/index.js');
                        const rawConfig = await loadConfig(opts.cwd);
                        const config = resolveConfig(rawConfig);
                        appName = config.name;
                    } catch {
                        const { readdirSync } = await import('node:fs');
                        const workspaces = readdirSync(iosDir).filter(f => f.endsWith('.xcworkspace'));
                        if (workspaces.length > 0) appName = workspaces[0].replace('.xcworkspace', '');
                    }

                    const workspace = join('ios', `${appName}.xcworkspace`);
                    try {
                        await runWithBuildFilter(
                            'xcodebuild',
                            [
                                '-workspace', workspace,
                                '-scheme', appName,
                                '-destination', `id=${simulator.udid}`,
                                '-configuration', 'Debug',
                                'build',
                            ],
                            { cwd: opts.cwd },
                            { kind: 'xcodebuild', verbose: opts.verbose ?? false, logger: opts.logger },
                        );
                    } catch {
                        opts.logger.error('iOS build failed');
                        return;
                    }
                    opts.logger.log('\x1b[32m✓ iOS app built\x1b[0m');

                    const appPath = findBuiltApp(appName);
                    if (!appPath) {
                        opts.logger.error(`Could not find built ${appName}.app in DerivedData`);
                        return;
                    }
                    opts.logger.log('Installing on simulator...');
                    if (!installAppOnSimulator(simulator.udid, appPath)) {
                        opts.logger.error('Failed to install app on simulator');
                        return;
                    }
                    opts.logger.log('\x1b[32m✓ App installed\x1b[0m');
                    invalidateDeviceStatusCache();

                    opts.logger.log(`Launching on ${simulator.name}...`);
                    try {
                        execSync(`xcrun simctl terminate "${simulator.udid}" "${opts.bundleId}"`, { stdio: 'pipe' });
                    } catch { /* not running */ }
                    launchIosApp(simulator.udid, opts.bundleId!, bundleUrl);
                })();
                break;
            }
        }
    });
}

/**
 * Probe for the first free TCP port at/after `start`. Returns `start` if
 * nothing is bound, otherwise increments until either a free port is found
 * or 50 ports have been tried (in which case the caller's `start` value is
 * returned unchanged and we let rsbuild's fallback handle it).
 */
async function findFreePort(start: number): Promise<number> {
    const check = (port: number): Promise<boolean> =>
        new Promise((resolve) => {
            const srv = createServer();
            srv.unref();
            srv.once('error', () => resolve(false));
            srv.listen(port, '0.0.0.0', () => {
                srv.close(() => resolve(true));
            });
        });
    for (let p = start; p < start + 50; p++) {
        // eslint-disable-next-line no-await-in-loop
        if (await check(p)) return p;
    }
    return start;
}

/**
 * Start the enhanced Lynx dev server.
 */
export async function startDevServer(opts: DevServerOptions): Promise<void> {
    const { cwd, logger, launchAppId, launchBundleId, iosSimulatorName, selectedTargets } = opts;
    const desiredPort = Number(opts.port) || 8788;
    // Probe for the first free port at/after `desiredPort` so we can bake the
    // correct URL into `__SIGX_DEV_LOG_URL__` (device log streaming) and the
    // device-launch banner BEFORE rspeedy starts binding. Without this, when
    // rsbuild falls back to a higher port the device-side log fetch targets
    // a dead URL and `serverState.port` is stale until the stdout parser
    // catches the "is in use" line — which the device build has already passed.
    const requestedPort = await findFreePort(desiredPort);
    const projectName = getProjectName(cwd);
    const lanIPs = getAllLanIPs();
    const primaryIP = lanIPs.length > 0 ? lanIPs[0].address : null;

    // Mutable server state so keyboard shortcuts always use the actual port
    const serverState = { port: requestedPort };
    // The plugin computes its log/reload WS port as `SIGX_LYNX_DEV_PORT + 1`
    // and binds it once at startup. Capture that here so the `r`-key reload
    // POST stays aimed at the right port even if rsbuild later bumps the
    // HTTP port — the plugin's WS port doesn't move once it's bound.
    const wsPort = requestedPort + 1;

    // Detect devices in parallel with server start. When the caller passed
    // an explicit target list (from the picker / flags), we skip the full
    // cross-platform probe — nothing downstream cares about e.g. Android
    // status on an iOS-only run.
    let deviceStatus: DeviceStatus = {
        devices: [],
        lynxGoInstalled: new Map(),
        adbAvailable: false,
        iosSimulators: [],
        xcrunAvailable: false,
        iosDevices: [],
        devicectlAvailable: false,
    };
    if (!selectedTargets) {
        try {
            deviceStatus = getDeviceStatus(launchAppId, launchBundleId);
        } catch {
            // Device detection is best-effort
        }
    }

    // Build rspeedy args. Rspeedy's CLI has no `--port` flag, so we pass the
    // port through `SIGX_LYNX_DEV_PORT` (read below in the spawn env) — the
    // `@sigx/lynx-plugin`'s `modifyRsbuildConfig` hook overrides
    // `server.port` from that env var. This keeps lynx-cli's `serverState.port`
    // (used for the device-launch URL) in lockstep with the port rspeedy
    // actually binds; if rsbuild still has to fall back (port already taken)
    // the stdout-parsing path below catches it.
    const args = ['rspeedy', 'dev'];
    if (opts.host) args.push('--host');

    // Start rspeedy in its own process group so we can kill the whole tree
    // on shutdown (npx spawns npm spawns node, and SIGTERM to the top doesn't
    // propagate reliably otherwise).
    //
    // `shell: true` is avoided because the extra /bin/sh hop plus piped stdin
    // causes Rspack's file watcher to stop firing (it works when rspeedy is
    // run directly but silently drops changes under shell+pipe). `ignore` for
    // stdin also keeps rspeedy from treating us as interactive.
    //
    // File watching: @sigx/lynx-plugin ships narrow `watchOptions.ignored`
    // (ios/android/Pods/dist/.rspeedy) via modifyRspackConfig so macOS
    // FSEvents stops drowning in native-build churn. If that still misses
    // events on an exotic layout, set `SIGX_LYNX_WATCH_POLL=250` to fall
    // back to polling at the plugin level.
    const child = spawn('npx', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: process.platform !== 'win32',
        env: {
            ...process.env,
            SIGX_LYNX_DEV_PORT: String(requestedPort),
        },
    });

    const killChildTree = (signal: NodeJS.Signals = 'SIGTERM') => {
        try {
            if (child.pid && process.platform !== 'win32') {
                // Negative PID targets the process group
                process.kill(-child.pid, signal);
            } else {
                child.kill(signal);
            }
        } catch {
            // Already gone
        }
    };

    let bannerPrinted = false;

    const showBanner = () => {
        if (bannerPrinted) return;
        bannerPrinted = true;
        printBanner({
            projectName,
            port: serverState.port,
            lanIPs,
            deviceStatus,
            appId: launchAppId,
            bundleId: launchBundleId,
            selectedTargets,
        });

        // Auto-launch on devices.
        // iOS uses LAN IP (simulator shares host network; devices are on Wi-Fi).
        // Android uses `adb reverse` + localhost so USB-only devices work too.
        const iosBundleUrl = primaryIP
            ? `http://${primaryIP}:${serverState.port}/main.lynx.bundle`
            : `http://localhost:${serverState.port}/main.lynx.bundle`;

        if (selectedTargets) {
            // Picker-driven: launch only what the user asked for. We just
            // finished `ensureAndroidBuilt` / `ensureIosBuilt` for each one,
            // so installation is guaranteed.
            for (const t of selectedTargets) {
                if (t.kind === 'android-device') {
                    adbReverse(t.deviceId, serverState.port);
                    const url = `http://localhost:${serverState.port}/main.lynx.bundle`;
                    if (launchAppId) {
                        logger.log(`Auto-launching ${launchAppId} on ${t.model || t.deviceId}...`);
                        launchApp(t.deviceId, launchAppId, url);
                    }
                } else if (t.kind === 'ios-simulator' && launchBundleId) {
                    logger.log(`Auto-launching on ${t.name}...`);
                    launchIosApp(t.udid, launchBundleId, iosBundleUrl);
                } else if (t.kind === 'ios-device' && launchBundleId) {
                    logger.log(`Auto-launching on ${t.name}...`);
                    launchAppOnDevice(t.udid, launchBundleId, iosBundleUrl);
                }
            }
            return;
        }

        // Legacy path: auto-launch on every discovered device (used when
        // `sigx dev` is invoked without going through the picker, e.g. from
        // `sigx run:android` / `sigx run:ios` which set up their own target).

        // Android
        for (const device of deviceStatus.devices) {
            adbReverse(device.id, serverState.port);
            const url = `http://localhost:${serverState.port}/main.lynx.bundle`;
            if (launchAppId && deviceStatus.appInstalled?.get(device.id)) {
                logger.log(`Auto-launching ${launchAppId} on ${device.model || device.id}...`);
                launchApp(device.id, launchAppId, url);
            } else if (deviceStatus.lynxGoInstalled.get(device.id)) {
                logger.log(`Auto-launching sigx-lynx-go on ${device.model || device.id}...`);
                launchLynxGo(device.id, url);
            }
        }

        // iOS simulators
        if (launchBundleId) {
            for (const sim of deviceStatus.iosSimulators) {
                if (deviceStatus.iosAppInstalled?.get(sim.udid)) {
                    logger.log(`Auto-launching on ${sim.name}...`);
                    launchIosApp(sim.udid, launchBundleId, iosBundleUrl);
                }
            }
            // iOS physical devices
            for (const dev of deviceStatus.iosDevices) {
                if (deviceStatus.iosDeviceAppInstalled?.get(dev.udid)) {
                    logger.log(`Auto-launching on ${dev.name}...`);
                    launchAppOnDevice(dev.udid, launchBundleId, iosBundleUrl);
                }
            }
        }
    };

    // Pipe rspeedy output with prefix.
    // We buffer partial lines (sentinel-tagged log entries from
    // @sigx/lynx-plugin's log middleware can be long and might be split
    // across chunks), then parse line-by-line.
    let stdoutBuf = '';
    child.stdout?.on('data', (data: Buffer) => {
        stdoutBuf += data.toString();
        const newlineIdx = stdoutBuf.lastIndexOf('\n');
        if (newlineIdx === -1) return;
        const ready = stdoutBuf.slice(0, newlineIdx);
        stdoutBuf = stdoutBuf.slice(newlineIdx + 1);

        for (const rawLine of ready.split('\n')) {
            // Device console log? Pretty-print and stop — never let the
            // sentinel-tagged raw form leak to the user's terminal.
            if (rawLine.startsWith(LOG_SENTINEL)) {
                const entry = parseDeviceLogLine(rawLine);
                if (entry && !opts.disableDeviceLogs) {
                    console.log(formatDeviceLogLine(entry));
                }
                continue;
            }
            const line = rawLine.trim();
            if (!line) continue;
            // Detect port conflict and update actual port. rsbuild logs:
            // `port N is in use, using port N+1.`
            // We need this *before* showBanner fires, because the banner
            // computes the device-launch URL from serverState.port.
            if (line.includes('is in use')) {
                const match = line.match(/using port (\d+)/);
                if (match) {
                    serverState.port = Number(match[1]);
                    logger.log(`Dev server fell back to port ${serverState.port}`);
                }
            }

            // Print banner once rspeedy is ready. No timeout-based
            // fallback: launching the app with a stale guessed port
            // (because rspeedy hadn't yet reported the actual port via
            // its `is in use` line) leaves the device pointing at a
            // server that isn't there. HMR then silently fails. Better
            // to wait — if rspeedy never starts the user will see its
            // own error output.
            if (line.includes('ready') && !bannerPrinted) {
                showBanner();
            }

            // Filter noisy rspeedy startup logs, show meaningful ones
            if (line.includes('rspeedy') && line.includes('ready')) {
                logger.log(`\x1b[32m${line}\x1b[0m`);
            } else if (line.includes('error') || line.includes('Error')) {
                logger.error(line);
            } else if (line.includes('warn') || line.includes('Warning')) {
                logger.warn(line);
            } else {
                console.log(`  ${line}`);
            }
        }
    });

    child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
            // Filter common non-error stderr noise
            if (text.includes('ExperimentalWarning') || text.includes('DEP0')) return;
            console.error(`  \x1b[31m${text}\x1b[0m`);
        }
    });

    // Setup keyboard shortcuts
    setupKeyboardShortcuts(child, { cwd, serverState, wsPort, lanIPs, projectName, logger, appId: launchAppId, bundleId: launchBundleId, iosSimulatorName, verbose: opts.verbose, killChildTree });

    // Handle child exit
    child.on('exit', (code) => {
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
        process.exit(code ?? 0);
    });

    // Propagate signals from the parent to the rspeedy tree so Ctrl+C
    // doesn't orphan the port-holding process.
    const handleSignal = (signal: NodeJS.Signals) => {
        logger.log(`Received ${signal}, shutting down...`);
        killChildTree(signal);
        setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGHUP', () => handleSignal('SIGHUP'));

    // Keep running until child exits
    await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
    });
}
