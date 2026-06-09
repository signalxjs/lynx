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
import { request as httpRequest } from 'node:http';
import { getAllLanIPs } from './network.js';
import { generateQR } from './qr.js';
import { getDeviceStatus, getDeviceStatusCached, invalidateDeviceStatusCache, launchLynxGo, launchApp, launchIosApp, launchAppOnDevice, resolveIosSimulator, bootSimulator, installAppOnSimulator, findBuiltApp, iosDerivedDataPath, adbReverse, adbReverseRemove, forceStopApp, getDeviceCpuAbi, LYNX_GO_PACKAGE, type DeviceStatus } from './device-detect.js';
import { runWithBuildFilter } from './build-output.js';
import type { Logger } from '@sigx/cli/plugin';
import type { SelectedTarget } from './target-picker.js';
import { parseDeviceLogLine, formatDeviceLogLine, LOG_SENTINEL } from './device-log.js';
import { isPortFree, isPortPairFree, readDevLock, writeDevLock, clearDevLock, isPidAlive, waitForPortFree } from './dev-lock.js';

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
    buildId: string;
    lanIPs: { name: string; address: string }[];
    deviceStatus: DeviceStatus;
    appId?: string;
    bundleId?: string;
    selectedTargets?: SelectedTarget[];
}) {
    const { projectName, port, buildId, lanIPs, deviceStatus, appId, bundleId, selectedTargets } = opts;

    const lines = [
        '',
        `  \x1b[1m⚡ sigx dev\x1b[0m · \x1b[33m${projectName}\x1b[0m`,
        '',
        `  Local:    \x1b[4m${bundleUrlFor('localhost', port, buildId)}\x1b[0m`,
    ];

    for (const { name, address } of lanIPs) {
        const url = bundleUrlFor(address, port, buildId);
        lines.push(`  Network:  \x1b[4m${url}\x1b[0m \x1b[2m(${name})\x1b[0m`);
    }

    lines.push('');

    // QR code for the primary bundle URL
    if (lanIPs.length > 0) {
        const primaryBundleUrl = bundleUrlFor(lanIPs[0].address, port, buildId);
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
    /** Build id baked into the bundle, appended to launch URLs as `?v=`. */
    buildId: string;
    lanIPs: { name: string; address: string }[];
    projectName: string;
    logger: Logger;
    appId?: string;
    bundleId?: string;
    iosSimulatorName?: string;
    verbose?: boolean;
    /** Centralized teardown: removes adb forwards + kills the rspeedy tree. */
    shutdown: () => void;
    /** Create an `adb reverse` forward AND record it for teardown. Keyboard
     *  relaunch paths must use this (not `adbReverse` directly) so the mapping
     *  is removed on shutdown. */
    addReverse: (deviceId: string, port: number) => void;
}) {
    if (!process.stdin.isTTY) return;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (key: string) => {
        const primaryIP = opts.lanIPs.length > 0 ? opts.lanIPs[0].address : null;
        const bundleUrl = bundleUrlFor(primaryIP ?? 'localhost', opts.serverState.port, opts.buildId);

        // Android devices reach the dev server via `adb reverse`, so their
        // per-device URL is always localhost (works over USB, Wi-Fi, or
        // no-network-at-all provided adb is connected).
        const androidUrlFor = (deviceId: string): string => {
            opts.addReverse(deviceId, opts.serverState.port);
            return bundleUrlFor('localhost', opts.serverState.port, opts.buildId);
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
                opts.shutdown();
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
                                // Project-local products dir — see #178.
                                '-derivedDataPath', iosDerivedDataPath(opts.cwd),
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

                    const appPath = findBuiltApp(opts.cwd, appName);
                    if (!appPath) {
                        opts.logger.error(`Could not find built ${appName}.app in ios/build`);
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
    for (let p = start; p < start + 50; p++) {
        // Need the HTTP+WS pair (p and p+1), since the plugin binds p+1.
        // eslint-disable-next-line no-await-in-loop
        if (await isPortPairFree(p)) return p;
    }
    return start;
}

/**
 * Acquire a STABLE dev-server port for this project.
 *
 * Unlike a blind free-port walk, this keeps `sigx dev` on the same port across
 * restarts so an already-running app — whose dev URLs are baked into the bundle
 * at build time — reconnects instead of being stranded:
 *
 *  - lock's owner is ALIVE           → a real `sigx dev` already serves this
 *                                      project; refuse + exit (never silently
 *                                      fork a second server). The escape hatch
 *                                      is an explicit `--port` on a DIFFERENT
 *                                      port, for intentionally running two.
 *  - desired port free               → take it.
 *  - busy, our lock's owner is DEAD  → an orphan that didn't release the port;
 *                                      wait briefly for the OS to free the
 *                                      socket, then reclaim the SAME port.
 *  - busy, no usable lock            → fall back to the free-port walk with a
 *                                      warning (a running app may need relaunch).
 *
 * The live-lock check runs FIRST (before the free-port probe) so a stale fallback
 * scenario — session A on 8790, 8788 later frees — can't slip a second server in.
 *
 * Returns the chosen port plus `ownLock`: `false` only for the explicit-`--port`
 * escape-hatch secondary (a live primary still owns the project lock), so the
 * caller leaves the primary's lock intact rather than clobbering it.
 */
async function acquireDevPort(
    desiredPort: number,
    explicitPort: boolean,
    cwd: string,
    logger: Logger,
): Promise<{ port: number; ownLock: boolean }> {
    const lock = readDevLock(cwd);
    const liveLock = lock && isPidAlive(lock.pid) ? lock : null;

    // A live server owns this project. Refuse regardless of which port happens
    // to be free now — unless the user explicitly asked for a DIFFERENT port.
    if (liveLock && !(explicitPort && desiredPort !== liveLock.httpPort)) {
        logger.error(
            `Another sigx dev is already running for this project ` +
            `(pid ${liveLock.pid}, port ${liveLock.httpPort}). Stop it first, or run with --port <n>.`,
        );
        process.exit(1);
    }

    // Allowed explicit-`--port` secondary, but its HTTP port and log/reload WS
    // port (`desiredPort + 1`) must not overlap the primary's pair — otherwise
    // the bundler binds while device logs/reload silently fail to start.
    if (liveLock && (
        desiredPort + 1 === liveLock.httpPort ||
        desiredPort === liveLock.wsPort ||
        desiredPort + 1 === liveLock.wsPort
    )) {
        logger.error(
            `--port ${desiredPort} collides with the running dev server ` +
            `(HTTP ${liveLock.httpPort}, log WS ${liveLock.wsPort}); its log WS would use ` +
            `${desiredPort + 1}. Pick a port at least 2 away.`,
        );
        process.exit(1);
    }

    // If we got here with a live lock, we're the explicit-port secondary — the
    // primary keeps the project lock; we don't own it.
    const ownLock = liveLock === null;

    // The stable port is whatever the LAST session used (from a dead lock),
    // not necessarily the default — so an app that baked the previous session's
    // fallback port (e.g. 8790, because 8788 was busy back then) can still
    // reconnect after a restart. An explicit `--port` always wins.
    const targetPort = !explicitPort && lock && !liveLock ? lock.httpPort : desiredPort;

    // The dev server needs the whole pair (targetPort + the WS port targetPort+1).
    if (await isPortPairFree(targetPort)) return { port: targetPort, ownLock };

    // Busy, and our own (now-dead) lock owned this port — the orphan didn't
    // release it. Wait for the HTTP port to free, then confirm the WS port is
    // free too, and reclaim the SAME port so the running app's baked URLs stay
    // valid.
    if (lock && !liveLock && lock.httpPort === targetPort) {
        if (await waitForPortFree(targetPort) && await isPortFree(targetPort + 1)) {
            logger.log(`Reclaimed dev port ${targetPort} from a previous session.`);
            return { port: targetPort, ownLock };
        }
    }

    // An explicit `--port` we can't honor (HTTP or WS half taken) is a hard
    // error — don't silently move to a different port the user didn't ask for.
    if (explicitPort) {
        logger.error(
            `Port ${targetPort} or its log/reload WS port ${targetPort + 1} is in use. ` +
            `Choose another --port.`,
        );
        process.exit(1);
    }

    // Genuinely contended (an unrelated process, or another project's server).
    const fallback = await findFreePort(targetPort);
    if (fallback !== targetPort) {
        logger.warn(
            `Port ${targetPort} is busy — using ${fallback} instead. ` +
            `A previously launched app may need a manual relaunch to reconnect.`,
        );
    }
    return { port: fallback, ownLock };
}

/**
 * Build the dev bundle URL for a host:port, tagged with the build id. The
 * `?v=<buildId>` query changes every server run, so a native relaunch after a
 * restart can't serve a prior-run cached template (rspeedy ignores the query;
 * `adb reverse` forwards it transparently).
 */
function bundleUrlFor(host: string, port: number, buildId: string): string {
    return `http://${host}:${port}/main.lynx.bundle?v=${encodeURIComponent(buildId)}`;
}

/**
 * Warn (once per device) when launching on an x86_64 Android target while the
 * project bundles icon sets: upstream `servalsvg` ships no x86_64 native lib,
 * so every `<svg>` — icons included — renders blank on those emulators
 * (signalxjs/lynx#270). arm64 devices/AVDs and iOS are unaffected. Best-effort:
 * config-load or adb failures just skip the warning.
 */
// Successful probes only — failed probes (null) are never cached, so the
// next launch retries them (see the loop below).
const _probedAbis = new Map<string, string>();
const _warnedSvgAbi = new Set<string>();
async function warnIfSvgAbiGap(cwd: string, deviceIds: string[], logger: Logger): Promise<void> {
    const ids = deviceIds.filter((id) => !_warnedSvgAbi.has(id));
    if (ids.length === 0) return;
    try {
        const { loadConfig } = await import('./prebuild.js');
        const { resolveConfig } = await import('./config/index.js');
        const config = resolveConfig(await loadConfig(cwd));
        if (config.iconSets.length === 0) return;
        for (const id of ids) {
            // Cache successful ABI probes per device; a failed probe (null)
            // stays uncached so a flaky adb gets retried on the next launch.
            let abi: string | null | undefined = _probedAbis.get(id);
            if (abi === undefined) {
                abi = getDeviceCpuAbi(id);
                if (abi !== null) _probedAbis.set(id, abi);
            }
            if (abi !== 'x86_64') continue;
            _warnedSvgAbi.add(id);
            logger.log(
                `\x1b[33m!\x1b[0m ${id} is an x86_64 emulator — Lynx's SVG engine has no x86_64 ` +
                `native lib, so icons (any <svg>) render blank there. Real devices and arm64 AVDs ` +
                `are unaffected. https://github.com/signalxjs/lynx/issues/270`,
            );
        }
    } catch { /* warning is best-effort only */ }
}

/**
 * Start the enhanced Lynx dev server.
 */
export async function startDevServer(opts: DevServerOptions): Promise<void> {
    const { cwd, logger, launchAppId, launchBundleId, iosSimulatorName, selectedTargets } = opts;
    // Parse an explicit `--port`. Reject invalid values instead of silently
    // falling back to 8788 (which would behave as an "explicit" override and
    // bypass the stable-port reclaim). Cap at 65534 because the log/reload WS
    // server binds `port + 1`, which must stay ≤ 65535.
    let desiredPort = 8788;
    let explicitPort = false;
    if (opts.port !== undefined && String(opts.port).trim() !== '') {
        const parsed = Number(opts.port);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65534) {
            logger.error(
                `Invalid --port "${opts.port}". Use an integer between 1 and 65534 ` +
                `(the device log/reload WS server binds port + 1).`,
            );
            process.exit(1);
        }
        desiredPort = parsed;
        explicitPort = true;
    }
    // Acquire a STABLE port (default 8788) so we can bake the correct URL into
    // `__SIGX_DEV_LOG_URL__` (device log streaming) and the device-launch
    // banner BEFORE rspeedy starts binding, AND so the same port survives a
    // restart — letting an already-running app reconnect instead of being
    // stranded. acquireDevPort reclaims the port from a dead previous session,
    // refuses to double-run a live one, and only walks to a new port as a last
    // resort. If rsbuild still has to fall back, the stdout parser below
    // catches the "is in use" line.
    const { port: requestedPort, ownLock } = await acquireDevPort(desiredPort, explicitPort, cwd, logger);
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

    // One identity per server lifetime. The CLI owns it (rather than letting
    // the plugin invent its own) so the launch URL, the baked `__SIGX_BUILD_ID__`
    // define, and the log-server `hello` all agree. A reconnecting app compares
    // the hello's id to the one baked in its running bundle and reloads when
    // they differ; `?v=<buildId>` on launch URLs busts a stale native cache.
    const buildId = String(Date.now());

    // Record ourselves as the owner of this port so a later `sigx dev` can
    // reclaim it after we exit, or refuse to double-run while we're alive.
    // Skipped for the explicit-`--port` secondary: a live primary already owns
    // the project lock and we must not clobber it.
    if (ownLock) {
        writeDevLock(cwd, { version: 1, pid: process.pid, httpPort: requestedPort, wsPort, startedAt: Date.now() });
    }

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
            SIGX_LYNX_BUILD_ID: buildId,
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

    // `adb reverse` mappings we've created, as `deviceId|port`. Removed on
    // shutdown so we don't leave stale tcp forwards lingering on a device's
    // adbd after the dev server is gone.
    const reverseForwards = new Set<string>();
    const addReverse = (deviceId: string, port: number): void => {
        if (adbReverse(deviceId, port)) reverseForwards.add(`${deviceId}|${port}`);
    };
    // Drop every forward we created. Idempotent (clears the set), so it's safe
    // to call from both the graceful shutdown and the child-exit handler.
    // Each adbReverseRemove is individually bounded, but several wedged devices
    // would add up — so cap the *total* wall-clock to keep Ctrl+C snappy
    // regardless of device count. Forwards not removed in time clear on device
    // disconnect anyway.
    const REVERSE_REMOVE_BUDGET_MS = 1_500;
    const removeReverses = (): void => {
        const deadline = Date.now() + REVERSE_REMOVE_BUDGET_MS;
        let skipped = 0;
        for (const fwd of reverseForwards) {
            if (Date.now() >= deadline) { skipped++; continue; }
            const sep = fwd.lastIndexOf('|');
            adbReverseRemove(fwd.slice(0, sep), Number(fwd.slice(sep + 1)));
        }
        if (skipped > 0) {
            logger.warn(`Skipped ${skipped} adb reverse cleanup(s) to keep shutdown fast; they clear on device disconnect.`);
        }
        reverseForwards.clear();
    };

    // Single, idempotent teardown for every exit path (Ctrl+C, `q`, SIGTERM,
    // SIGHUP). Restores the TTY, drops adb forwards, then kills the rspeedy
    // process group with SIGTERM → wait → SIGKILL escalation so a wedged
    // rspeedy/rspack can never be orphaned still holding the port.
    let shuttingDown = false;
    const shutdown = (exitCode = 0): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.log('Shutting down...');

        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); } catch { /* ignore */ }
        }

        // Signal the tree first (instant, non-blocking) so it starts dying
        // while we run the synchronous, time-bounded forward cleanup. The
        // child `exit` handler calls process.exit once the tree is gone.
        killChildTree('SIGTERM');
        removeReverses();
        // NB: we do NOT clear the lock here. The rspeedy child still holds the
        // port during the SIGTERM→SIGKILL window, and our pid is still alive —
        // so a racing restart should still see a live lock and refuse, rather
        // than slip a second server in. The lock is released in `child.on('exit')`
        // (port actually freed); if we're force-killed first, the next run finds
        // a dead-pid lock and reclaims it.

        const escalate = setTimeout(() => {
            logger.warn('Dev server did not exit after SIGTERM — forcing SIGKILL.');
            killChildTree('SIGKILL');
        }, 3_000);
        escalate.unref();
        // Hard backstop: never leave the user's terminal hanging on a stuck child.
        setTimeout(() => process.exit(exitCode), 6_000).unref();
    };

    let bannerPrinted = false;

    const showBanner = () => {
        if (bannerPrinted) return;
        bannerPrinted = true;
        printBanner({
            projectName,
            port: serverState.port,
            buildId,
            lanIPs,
            deviceStatus,
            appId: launchAppId,
            bundleId: launchBundleId,
            selectedTargets,
        });

        // Auto-launch on devices.
        // iOS uses LAN IP (simulator shares host network; devices are on Wi-Fi).
        // Android uses `adb reverse` + localhost so USB-only devices work too.
        const iosBundleUrl = bundleUrlFor(primaryIP ?? 'localhost', serverState.port, buildId);

        if (selectedTargets) {
            // Picker-driven: launch only what the user asked for. We just
            // finished `ensureAndroidBuilt` / `ensureIosBuilt` for each one,
            // so installation is guaranteed.
            void warnIfSvgAbiGap(
                cwd,
                selectedTargets.filter((t) => t.kind === 'android-device').map((t) => t.deviceId),
                logger,
            );
            for (const t of selectedTargets) {
                if (t.kind === 'android-device') {
                    addReverse(t.deviceId, serverState.port);
                    const url = bundleUrlFor('localhost', serverState.port, buildId);
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
        void warnIfSvgAbiGap(cwd, deviceStatus.devices.map((d) => d.id), logger);
        for (const device of deviceStatus.devices) {
            addReverse(device.id, serverState.port);
            const url = bundleUrlFor('localhost', serverState.port, buildId);
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
    setupKeyboardShortcuts(child, { cwd, serverState, wsPort, buildId, lanIPs, projectName, logger, appId: launchAppId, bundleId: launchBundleId, iosSimulatorName, verbose: opts.verbose, shutdown, addReverse });

    // Handle child exit — the rspeedy tree died (on its own or because we
    // signaled it during shutdown). Restore the TTY, drop any adb forwards we
    // created (a crash/early-failure exit never goes through shutdown()), and
    // exit with its code. removeReverses() is idempotent, so this is a no-op
    // when shutdown() already ran.
    // If the rspeedy child can't even be spawned (`npx`/`rspeedy` missing,
    // EACCES, …), `exit`/`close` may never fire — we'd hang on the await below
    // and leave a live-pid lock behind, making later runs refuse incorrectly.
    // Release everything and bail with a clear message.
    child.once('error', (err) => {
        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); } catch { /* ignore */ }
        }
        removeReverses();
        if (readDevLock(cwd)?.pid === process.pid) clearDevLock(cwd);
        logger.error(`Failed to start dev server: ${(err as Error).message}`);
        process.exit(1);
    });

    child.on('exit', (code) => {
        if (process.stdin.isTTY) {
            try { process.stdin.setRawMode(false); } catch { /* ignore */ }
        }
        removeReverses();
        if (readDevLock(cwd)?.pid === process.pid) clearDevLock(cwd);
        process.exit(code ?? 0);
    });

    // Propagate signals from the parent through the centralized teardown so
    // Ctrl+C / SIGTERM / SIGHUP drop adb forwards and never orphan the
    // port-holding rspeedy tree.
    process.on('SIGINT', () => shutdown());
    process.on('SIGTERM', () => shutdown());
    process.on('SIGHUP', () => shutdown());

    // Keep running until child exits
    await new Promise<void>((resolve) => {
        child.on('close', () => resolve());
    });
}
