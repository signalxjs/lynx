/**
 * @sigx/lynx-cli plugin
 *
 * Registers dev, build, prebuild, doctor, and run commands with the sigx CLI.
 * Auto-detected when a project has signalx.config.ts.
 */

import { definePlugin } from '@sigx/cli/plugin';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function isLynxProject(cwd: string): boolean {
    return (
        existsSync(join(cwd, 'signalx.config.ts')) ||
        existsSync(join(cwd, 'signalx.config.js')) ||
        existsSync(join(cwd, 'signalx.config.mjs')) ||
        existsSync(join(cwd, 'lynx.config.ts')) ||
        existsSync(join(cwd, 'lynx.config.js'))
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDirSize(dir: string): { size: number; files: number } {
    let size = 0;
    let files = 0;

    if (!existsSync(dir)) return { size, files };

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = getDirSize(fullPath);
            size += sub.size;
            files += sub.files;
        } else {
            size += statSync(fullPath).size;
            files++;
        }
    }

    return { size, files };
}

export default definePlugin({
    name: 'lynx',
    detect: isLynxProject,
    commands: {
        dev: {
            description: 'Start Lynx development server with sigx-lynx-go integration',
            args: {
                port: { type: 'string', description: 'Port number (default: 8788)' },
                host: { type: 'boolean', description: 'Expose to network', default: false },
                ios: { type: 'boolean', description: 'Target iOS only (skip picker)', default: false },
                android: { type: 'boolean', description: 'Target Android only (skip picker)', default: false },
                all: { type: 'boolean', description: 'Auto-target every connected device (skip picker)', default: false },
                verbose: { type: 'boolean', description: 'Stream raw xcodebuild/gradle output (default: filtered)', default: false },
            },
            async run(ctx) {
                const androidDir = join(ctx.cwd, 'android');
                const iosDir = join(ctx.cwd, 'ios');
                let hasAndroid = existsSync(androidDir);
                let hasIos = existsSync(iosDir) && process.platform === 'darwin';

                // First-run auto-prebuild: fresh Lynx projects scaffolded by
                // `pnpm create @sigx` have a signalx.config.ts but no native
                // android/ or ios/ folders yet. Without those, target detection
                // falls through to the legacy QR-only mode and the user gets
                // "no iOS or Android targets detected" — same cli code, just
                // gated on missing folders. Run prebuild once so dev "just
                // works" without forcing every new user to remember the
                // `pnpm prebuild` step.
                if (!hasAndroid && !hasIos && isLynxProject(ctx.cwd)) {
                    ctx.logger.log('First-time setup: no android/ or ios/ folder found — running prebuild...');
                    const { runPrebuild } = await import('./prebuild.js');
                    await runPrebuild({ cwd: ctx.cwd });
                    hasAndroid = existsSync(androidDir);
                    hasIos = existsSync(iosDir) && process.platform === 'darwin';
                }

                // Resolve ids from signalx.config.ts (for banner + auto-launch).
                let launchAppId: string | undefined;
                let launchBundleId: string | undefined;
                let appName: string | undefined;
                if (hasAndroid || hasIos) {
                    try {
                        const { loadConfig } = await import('./prebuild.js');
                        const { resolveConfig } = await import('./config/index.js');
                        const rawConfig = await loadConfig(ctx.cwd);
                        const config = resolveConfig(rawConfig);
                        appName = config.name;
                        const fallback = `com.sigx.${config.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                        if (hasAndroid) launchAppId = config.android.applicationId ?? fallback;
                        if (hasIos) launchBundleId = config.ios.bundleIdentifier ?? fallback;
                    } catch {
                        // Config not available — skip custom app detection
                    }
                }

                const flagIos = ctx.args.ios as boolean;
                const flagAndroid = ctx.args.android as boolean;
                const flagAll = ctx.args.all as boolean;
                const anyFlag = flagIos || flagAndroid || flagAll;

                const { resolveVerbose } = await import('./build-output.js');
                const verbose = resolveVerbose(ctx.args.verbose);

                const { pickTargets, materializeTargets } = await import('./target-picker.js');
                type Target = import('./target-picker.js').SelectedTarget;

                let selected: Target[] | null;

                if (anyFlag) {
                    // Flag-driven: build target list from current detection, filtered by flag.
                    const { listBootedSimulators, listConnectedIosDevices, listAndroidDevices, resolveIosSimulator } = await import('./device-detect.js');
                    const all: Target[] = [];
                    if ((flagIos || flagAll) && hasIos) {
                        const booted = listBootedSimulators();
                        const devices = listConnectedIosDevices();
                        for (const s of booted) {
                            all.push({ kind: 'ios-simulator', udid: s.udid, name: s.name, needsBoot: false });
                        }
                        for (const d of devices) {
                            all.push({ kind: 'ios-device', udid: d.udid, name: d.name });
                        }
                        // If nothing iOS-shaped is live, pick the newest iPhone and boot it
                        // so `--ios` "just works" the way `sigx dev:ios` does.
                        if (booted.length === 0 && devices.length === 0) {
                            const sim = resolveIosSimulator();
                            if (sim) {
                                all.push({ kind: 'ios-simulator', udid: sim.udid, name: sim.name, needsBoot: true });
                            } else {
                                ctx.logger.warn('No iOS simulators available. Install one via Xcode → Settings → Platforms.');
                            }
                        }
                    }
                    if ((flagAndroid || flagAll) && hasAndroid) {
                        const androidDevices = listAndroidDevices();
                        for (const d of androidDevices) {
                            all.push({ kind: 'android-device', deviceId: d.id, model: d.model });
                        }
                        // If nothing Android-shaped is live, launch the most-recent AVD
                        // so `--android` mirrors the iOS auto-boot fallback above.
                        if (androidDevices.length === 0) {
                            const { listAndroidAvds } = await import('./target-picker.js');
                            const avds = listAndroidAvds();
                            if (avds.length > 0) {
                                all.push({ kind: 'android-avd', avdName: avds[0] });
                            } else {
                                ctx.logger.warn('No Android devices connected and no AVDs found. Open Android Studio → Device Manager to create one.');
                            }
                        }
                    }
                    selected = all;
                } else if (process.stdin.isTTY) {
                    selected = await pickTargets({ hasAndroid, hasIos });
                    if (selected === null) {
                        ctx.logger.log('Cancelled.');
                        process.exit(0);
                    }
                } else {
                    // Non-TTY, no flags: behave like --all.
                    ctx.logger.log('Non-TTY environment — auto-targeting all detected devices (pass --ios/--android to narrow).');
                    const { listBootedSimulators, listConnectedIosDevices, listAndroidDevices, resolveIosSimulator } = await import('./device-detect.js');
                    const all: Target[] = [];
                    if (hasIos) {
                        const booted = listBootedSimulators();
                        const devices = listConnectedIosDevices();
                        for (const s of booted) {
                            all.push({ kind: 'ios-simulator', udid: s.udid, name: s.name, needsBoot: false });
                        }
                        for (const d of devices) {
                            all.push({ kind: 'ios-device', udid: d.udid, name: d.name });
                        }
                        if (booted.length === 0 && devices.length === 0) {
                            const sim = resolveIosSimulator();
                            if (sim) all.push({ kind: 'ios-simulator', udid: sim.udid, name: sim.name, needsBoot: true });
                        }
                    }
                    if (hasAndroid) {
                        const androidDevices = listAndroidDevices();
                        for (const d of androidDevices) {
                            all.push({ kind: 'android-device', deviceId: d.id, model: d.model });
                        }
                        if (androidDevices.length === 0) {
                            const { listAndroidAvds } = await import('./target-picker.js');
                            const avds = listAndroidAvds();
                            if (avds.length > 0) {
                                all.push({ kind: 'android-avd', avdName: avds[0] });
                            }
                        }
                    }
                    selected = all;
                }

                // Materialize (boot sims, launch AVDs, wait for them to come up).
                const live = await materializeTargets(selected, ctx.logger);

                // Build / install per platform.
                const hasAndroidTarget = live.some((t) => t.kind === 'android-device');
                const hasIosTargets = live.filter((t) => t.kind === 'ios-simulator' || t.kind === 'ios-device');

                if (hasAndroidTarget) {
                    const { ensureAndroidBuilt } = await import('./android-run.js');
                    try {
                        await ensureAndroidBuilt({ cwd: ctx.cwd, logger: ctx.logger, applicationId: launchAppId, verbose });
                    } catch (err) {
                        ctx.logger.error(err instanceof Error ? err.message : String(err));
                        process.exit(1);
                    }
                }

                if (hasIosTargets.length > 0) {
                    if (!appName) {
                        ctx.logger.error('iOS targets selected but signalx.config.ts could not be loaded.');
                        process.exit(1);
                    }
                    const { ensureIosBuilt } = await import('./ios-run.js');
                    for (const t of hasIosTargets) {
                        if (t.kind !== 'ios-simulator' && t.kind !== 'ios-device') continue;
                        try {
                            await ensureIosBuilt({
                                cwd: ctx.cwd,
                                logger: ctx.logger,
                                appName,
                                target: { kind: t.kind === 'ios-simulator' ? 'simulator' : 'device', udid: t.udid, name: t.name },
                                verbose,
                            });
                        } catch (err) {
                            ctx.logger.error(err instanceof Error ? err.message : String(err));
                            // Keep going — other targets may still be usable.
                        }
                    }
                }

                // Skip the JS dev server (rspeedy) for apps with no Lynx JS
                // source — sandbox apps like Go that load bundles from URLs
                // at runtime via DevHomeScreen. They don't ship their own
                // bundle, so there's nothing to build/watch here.
                const hasLynxJsConfig =
                    existsSync(join(ctx.cwd, 'lynx.config.ts')) ||
                    existsSync(join(ctx.cwd, 'lynx.config.js')) ||
                    existsSync(join(ctx.cwd, 'lynx.config.mjs'));
                if (!hasLynxJsConfig) {
                    ctx.logger.log('No lynx.config.ts found — skipping JS dev server. App is a bundle-loader (e.g. sigx-lynx-go); paste a dev URL in DevHomeScreen to load a bundle.');
                    // Launching is normally owned by the dev server's
                    // rspeedy-ready handler. With no JS dev server, fire one
                    // launch per installed target now so the app actually
                    // opens — without a URL, MainActivity / ContentView fall
                    // through to DevHomeScreen.
                    const { launchApp, launchIosApp, launchAppOnDevice } = await import('./device-detect.js');
                    for (const t of live) {
                        let label: string = '';
                        let ok = false;
                        if (t.kind === 'ios-simulator' && launchBundleId) {
                            label = `iOS sim (${t.name})`;
                            ok = launchIosApp(t.udid, launchBundleId);
                        } else if (t.kind === 'ios-device' && launchBundleId) {
                            label = `iOS device (${t.name})`;
                            ok = launchAppOnDevice(t.udid, launchBundleId);
                        } else if (t.kind === 'android-device' && launchAppId) {
                            label = `Android (${t.model ?? t.deviceId})`;
                            ok = launchApp(t.deviceId, launchAppId, '');
                        }
                        if (label) {
                            ctx.logger.log(ok ? `\x1b[32m✓ Launched ${label}\x1b[0m` : `\x1b[31m✗ Launch failed: ${label}\x1b[0m`);
                        }
                    }
                    return;
                }

                const { startDevServer } = await import('./dev-server.js');
                await startDevServer({
                    cwd: ctx.cwd,
                    port: ctx.args.port as string | undefined,
                    host: ctx.args.host as boolean | undefined,
                    logger: ctx.logger,
                    launchAppId,
                    launchBundleId,
                    selectedTargets: live,
                    verbose,
                });
            },
        },
        build: {
            description: 'Production Lynx build',
            args: {
                analyze: { type: 'boolean', description: 'Analyze bundle size', default: false },
            },
            async run(ctx) {
                const { spawn } = await import('node:child_process');
                const startTime = Date.now();

                console.log('\n  \x1b[1m⚡ sigx build\x1b[0m\n');

                const args = ['rspeedy', 'build'];
                if (ctx.args.analyze) args.push('--analyze');

                const child = spawn('npx', args, {
                    cwd: ctx.cwd,
                    stdio: 'inherit',
                    shell: true,
                });

                child.on('exit', (code) => {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

                    if (code === 0) {
                        // Show build summary
                        const distDir = join(ctx.cwd, 'dist');
                        const { size, files } = getDirSize(distDir);

                        console.log('\n  \x1b[32m✓ Build complete\x1b[0m');
                        console.log(`  Time:    ${elapsed}s`);
                        console.log(`  Output:  ${distDir}`);
                        if (files > 0) {
                            console.log(`  Size:    ${formatBytes(size)} (${files} files)`);
                        }
                        console.log('');
                    } else {
                        console.log(`\n  \x1b[31m✗ Build failed\x1b[0m (${elapsed}s)\n`);
                    }

                    process.exit(code ?? 0);
                });
            },
        },
        doctor: {
            description: 'Check your Lynx development environment',
            async run(ctx) {
                const { runDoctor } = await import('./doctor.js');
                await runDoctor(ctx.cwd, ctx.logger);
            },
        },
        outdated: {
            description: 'List installed @sigx/lynx-* packages and check for updates',
            args: {
                tag: { type: 'string', description: 'Compare against a dist-tag instead of "latest" (e.g. "canary")' },
            },
            async run(ctx) {
                const { runOutdated } = await import('./outdated.js');
                const result = await runOutdated({
                    cwd: ctx.cwd,
                    tag: ctx.args.tag as string | undefined,
                });
                if (result.outOfSync > 0 || result.updatesAvailable > 0) process.exit(1);
            },
        },
        upgrade: {
            description: 'Upgrade all @sigx/lynx-* packages to the latest (or a target) version',
            args: {
                to: { type: 'string', description: 'Target version (e.g. "0.5.0") or dist-tag (e.g. "canary"). Default: latest.' },
                'dry-run': { type: 'boolean', description: 'Print the planned diff without writing package.json or installing', default: false },
                exact: { type: 'boolean', description: 'Pin to exact versions (no ^ prefix)', default: false },
                force: { type: 'boolean', description: 'Bypass the dirty-tree gate', default: false },
            },
            async run(ctx) {
                const { runUpgrade } = await import('./upgrade.js');
                await runUpgrade({
                    cwd: ctx.cwd,
                    target: ctx.args.to as string | undefined,
                    dryRun: ctx.args['dry-run'] as boolean | undefined,
                    exact: ctx.args.exact as boolean | undefined,
                    force: ctx.args.force as boolean | undefined,
                });
            },
        },
        add: {
            description: 'Add @sigx/lynx-* module(s) at the version matching your existing sigx deps',
            args: {
                exact: { type: 'boolean', description: 'Pin to exact version (no ^ prefix)', default: false },
                force: { type: 'boolean', description: 'Bypass the dirty-tree gate', default: false },
            },
            async run(ctx) {
                const { runAdd } = await import('./packages.js');
                const modules = ((ctx.args._ as string[] | undefined) ?? []).filter((s) => typeof s === 'string');
                await runAdd({
                    cwd: ctx.cwd,
                    modules,
                    exact: ctx.args.exact as boolean | undefined,
                    force: ctx.args.force as boolean | undefined,
                });
            },
        },
        remove: {
            description: 'Remove @sigx/lynx-* module(s) from the project',
            async run(ctx) {
                const { runRemove } = await import('./packages.js');
                const modules = ((ctx.args._ as string[] | undefined) ?? []).filter((s) => typeof s === 'string');
                await runRemove({ cwd: ctx.cwd, modules });
            },
        },
        prebuild: {
            description: 'Generate native project files from signalx.config.ts',
            args: {
                android: { type: 'boolean', description: 'Android only' },
                ios: { type: 'boolean', description: 'iOS only' },
                clean: { type: 'boolean', description: 'Clean generated files first' },
            },
            async run(ctx) {
                const { runPrebuild } = await import('./prebuild.js');

                const android = ctx.args.android as boolean | undefined;
                const ios = ctx.args.ios as boolean | undefined;

                await runPrebuild({
                    android: (!android && !ios) ? true : !!android,
                    ios: (!android && !ios) ? true : !!ios,
                    clean: ctx.args.clean as boolean | undefined,
                    cwd: ctx.cwd,
                });
            },
        },
        'run:android': {
            description: 'Build and launch on Android device/emulator',
            args: {
                release: { type: 'boolean', description: 'Build in release mode (no dev server)', default: false },
                verbose: { type: 'boolean', description: 'Stream raw gradle output (default: filtered)', default: false },
            },
            async run(ctx) {
                const { runPrebuild, loadConfig } = await import('./prebuild.js');
                const { resolveConfig } = await import('./config/index.js');
                const { spawn, execSync } = await import('node:child_process');
                const { existsSync: fsExists, mkdirSync, copyFileSync } = await import('node:fs');
                const { getAllLanIPs } = await import('./network.js');
                const { getDeviceStatus, launchApp, resolveAdb } = await import('./device-detect.js');
                const { generateQR } = await import('./qr.js');
                const { resolveVerbose } = await import('./build-output.js');

                const androidDir = join(ctx.cwd, 'android');
                const isRelease = ctx.args.release as boolean;
                const verbose = resolveVerbose(ctx.args.verbose);

                // Load config for applicationId
                const rawConfig = await loadConfig(ctx.cwd);
                const config = resolveConfig(rawConfig);
                const applicationId = config.android.applicationId ??
                    `com.sigx.${config.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

                // Release mode: build JS bundle → copy to assets → gradle build → launch
                if (isRelease) {
                    const { runGradleWithDx } = await import('./android-run.js');

                    ctx.logger.log('Building JS bundle...');
                    const bundleBuild = spawn('npx', ['rspeedy', 'build'], {
                        cwd: ctx.cwd,
                        stdio: 'inherit',
                        shell: true,
                    });

                    await new Promise<void>((resolve, reject) => {
                        bundleBuild.on('exit', (code) => {
                            if (code !== 0) reject(new Error('JS bundle build failed'));
                            else resolve();
                        });
                    });

                    // Prebuild
                    ctx.logger.log('Running prebuild for Android...');
                    await runPrebuild({ android: true, ios: false, cwd: ctx.cwd });

                    // Copy bundle to assets
                    const distBundle = join(ctx.cwd, 'dist', 'main.lynx.bundle');
                    const assetsDir = join(androidDir, 'app', 'src', 'main', 'assets');
                    if (!fsExists(assetsDir)) mkdirSync(assetsDir, { recursive: true });
                    if (fsExists(distBundle)) {
                        copyFileSync(distBundle, join(assetsDir, 'main.lynx.bundle'));
                        ctx.logger.log('Bundle copied to android assets');
                    } else {
                        ctx.logger.error('Bundle not found at dist/main.lynx.bundle');
                        process.exit(1);
                    }

                    // Gradle build + install (with signature-mismatch detection + friendly hint)
                    ctx.logger.log('Building Android (release)...');
                    try {
                        await runGradleWithDx(['installRelease'], {
                            cwd: androidDir,
                            logger: ctx.logger,
                            applicationId,
                            verbose,
                        });
                    } catch (err) {
                        ctx.logger.error(err instanceof Error ? err.message : String(err));
                        process.exit(1);
                    }

                    ctx.logger.log('Launching app...');
                    const adbBin = resolveAdb() ?? 'adb';
                    const launch = spawn(adbBin, [
                        'shell', 'am', 'start',
                        '-n', `${applicationId}/${applicationId}.MainActivity`,
                    ], { stdio: 'inherit' });

                    launch.on('exit', (launchCode) => {
                        if (launchCode !== 0) {
                            ctx.logger.error('Failed to launch app');
                        } else {
                            ctx.logger.log('\x1b[32m✓ App launched (release)\x1b[0m');
                        }
                        process.exit(launchCode ?? 0);
                    });
                    return;
                }

                // Dev mode: prebuild → gradle build → start dev server → launch with URL
                if (!existsSync(androidDir)) {
                    ctx.logger.log('No android/ directory found — running prebuild...');
                }

                const { ensureAndroidBuilt } = await import('./android-run.js');
                await ensureAndroidBuilt({ cwd: ctx.cwd, logger: ctx.logger, applicationId, verbose });

                // Start dev server
                const { startDevServer } = await import('./dev-server.js');
                await startDevServer({
                    cwd: ctx.cwd,
                    logger: ctx.logger,
                    launchAppId: applicationId,
                    verbose,
                });
            },
        },
        'run:ios': {
            description: 'Build and launch on iOS simulator or connected device',
            args: {
                release: { type: 'boolean', description: 'Build in release mode (no dev server)', default: false },
                simulator: { type: 'string', description: 'Simulator name (auto-detected if omitted)' },
                device: { type: 'string', description: 'Physical device name or UDID (requires Xcode 15+)' },
                verbose: { type: 'boolean', description: 'Stream raw xcodebuild output (default: filtered)', default: false },
            },
            async run(ctx) {
                if (process.platform !== 'darwin') {
                    ctx.logger.error('run:ios requires macOS');
                    process.exit(1);
                }

                const { runPrebuild, loadConfig } = await import('./prebuild.js');
                const { resolveConfig } = await import('./config/index.js');
                const { spawn, execSync } = await import('node:child_process');
                const { existsSync: fsExists, mkdirSync, copyFileSync } = await import('node:fs');
                const {
                    resolveIosSimulator, bootSimulator, installAppOnSimulator, findBuiltApp,
                    listConnectedIosDevices, installAppOnDevice, launchAppOnDevice, isDevicectlAvailable,
                } = await import('./device-detect.js');
                const { podInstallIfStale } = await import('./ios-pods.js');
                const { runWithBuildFilter, resolveVerbose } = await import('./build-output.js');

                const iosDir = join(ctx.cwd, 'ios');
                const isRelease = ctx.args.release as boolean;
                const requestedSimulator = ctx.args.simulator as string | undefined;
                const requestedDevice = ctx.args.device as string | undefined;
                const verbose = resolveVerbose(ctx.args.verbose);

                // Load config
                const rawConfig = await loadConfig(ctx.cwd);
                const config = resolveConfig(rawConfig);
                const appName = config.name;
                const bundleId = config.ios.bundleIdentifier ??
                    `com.sigx.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

                // Pick target: physical device if --device given, else simulator.
                type Target =
                    | { kind: 'simulator'; udid: string; name: string }
                    | { kind: 'device'; udid: string; name: string };
                let target: Target;

                if (requestedDevice !== undefined) {
                    if (!isDevicectlAvailable()) {
                        ctx.logger.error('xcrun devicectl not found. Requires Xcode 15+.');
                        process.exit(1);
                    }
                    const devices = listConnectedIosDevices();
                    if (devices.length === 0) {
                        ctx.logger.error('No paired iOS devices connected. Plug in a device and trust this computer.');
                        process.exit(1);
                    }
                    // Empty string or "true" means "pick first"; otherwise match by name/udid.
                    const filter = requestedDevice === '' || requestedDevice === 'true' ? null : requestedDevice;
                    const match = filter
                        ? devices.find(d => d.udid === filter || d.name === filter)
                        : devices[0];
                    if (!match) {
                        ctx.logger.error(`No connected device matching "${filter}". Available: ${devices.map(d => d.name).join(', ')}`);
                        process.exit(1);
                    }
                    target = { kind: 'device', udid: match.udid, name: match.name };
                    ctx.logger.log(`Device: ${target.name} (${target.udid})`);
                } else {
                    const resolved = resolveIosSimulator(requestedSimulator);
                    if (!resolved) {
                        ctx.logger.error('No iOS simulators available. Install simulators via Xcode → Settings → Platforms.');
                        process.exit(1);
                    }
                    if (resolved.state !== 'Booted') {
                        ctx.logger.log(`Booting ${resolved.name}...`);
                        bootSimulator(resolved.udid);
                    }
                    try { execSync('open -a Simulator', { stdio: 'pipe' }); } catch {}
                    target = { kind: 'simulator', udid: resolved.udid, name: resolved.name };
                    ctx.logger.log(`Simulator: ${target.name} (${target.udid})`);
                }

                // Helper: install pods if the Podfile has changed or lock is missing.
                async function podInstallIfNeeded() {
                    await podInstallIfStale(iosDir, ctx.logger);
                }

                // Helper: xcodebuild for the chosen target.
                async function xcodeBuild(configuration: string) {
                    const workspace = join('ios', `${appName}.xcworkspace`);
                    ctx.logger.log(`Building iOS (${configuration}) for ${target.kind}...`);
                    try {
                        await runWithBuildFilter(
                            'xcodebuild',
                            [
                                '-workspace', workspace,
                                '-scheme', appName,
                                '-destination', `id=${target.udid}`,
                                '-configuration', configuration,
                                'build',
                            ],
                            { cwd: ctx.cwd },
                            { kind: 'xcodebuild', verbose, logger: ctx.logger },
                        );
                    } catch {
                        if (target.kind === 'device') {
                            ctx.logger.error('Device build failed. Check that a development team is selected in Xcode (Signing & Capabilities).');
                        }
                        throw new Error(`iOS ${configuration} build failed`);
                    }
                }

                // Helper: install + launch app on the chosen target.
                function installAndLaunchApp(
                    devUrl?: string,
                    configuration: 'Debug' | 'Release' = 'Debug',
                ) {
                    const buildTarget = target.kind === 'device' ? 'device' : 'simulator';
                    const appPath = findBuiltApp(appName, buildTarget, configuration);
                    if (!appPath) {
                        ctx.logger.error(`Could not find built ${appName}.app in DerivedData (${buildTarget}, ${configuration})`);
                        return;
                    }

                    ctx.logger.log(`Installing on ${target.kind}...`);
                    const installed = target.kind === 'device'
                        ? installAppOnDevice(target.udid, appPath)
                        : installAppOnSimulator(target.udid, appPath);
                    if (!installed) {
                        ctx.logger.error(`Failed to install app on ${target.kind}`);
                        if (target.kind === 'device') {
                            ctx.logger.error('Ensure the device is unlocked, trusted, and Developer Mode is enabled.');
                        }
                        return;
                    }
                    ctx.logger.log('\x1b[32m✓ App installed\x1b[0m');

                    ctx.logger.log(`Launching on ${target.kind}...`);
                    if (target.kind === 'device') {
                        if (!launchAppOnDevice(target.udid, bundleId, devUrl)) {
                            ctx.logger.error('Failed to launch on device');
                            return;
                        }
                    } else {
                        const launchArgs = ['simctl', 'launch', target.udid, bundleId];
                        if (devUrl) launchArgs.push('--sigx_dev_url', devUrl);
                        execSync(`xcrun ${launchArgs.map(a => `"${a}"`).join(' ')}`);
                    }
                    ctx.logger.log('\x1b[32m✓ App launched\x1b[0m');
                }

                // Release mode: build JS bundle → copy to app → prebuild → build → launch
                if (isRelease) {
                    ctx.logger.log('Building JS bundle...');
                    const bundleBuild = spawn('npx', ['rspeedy', 'build'], {
                        cwd: ctx.cwd,
                        stdio: 'inherit',
                        shell: true,
                    });
                    await new Promise<void>((resolve, reject) => {
                        bundleBuild.on('exit', (code) => {
                            if (code !== 0) reject(new Error('JS bundle build failed'));
                            else resolve();
                        });
                    });

                    ctx.logger.log('Running prebuild for iOS...');
                    await runPrebuild({ android: false, ios: true, cwd: ctx.cwd });

                    // Copy bundle to iOS app directory
                    const distBundle = join(ctx.cwd, 'dist', 'main.lynx.bundle');
                    const appDir = join(iosDir, appName);
                    if (fsExists(distBundle)) {
                        copyFileSync(distBundle, join(appDir, 'main.lynx.bundle'));
                        ctx.logger.log('Bundle copied to iOS app');
                    } else {
                        ctx.logger.error('Bundle not found at dist/main.lynx.bundle');
                        process.exit(1);
                    }

                    await podInstallIfNeeded();
                    await xcodeBuild('Release');
                    installAndLaunchApp(undefined, 'Release');
                    process.exit(0);
                    return;
                }

                // Dev mode: prebuild → build debug → start dev server → launch with URL
                if (!fsExists(iosDir)) {
                    ctx.logger.log('No ios/ directory found — running prebuild...');
                }

                const { ensureIosBuilt } = await import('./ios-run.js');
                try {
                    await ensureIosBuilt({
                        cwd: ctx.cwd,
                        logger: ctx.logger,
                        appName,
                        target,
                        verbose,
                    });
                } catch (err) {
                    ctx.logger.error(err instanceof Error ? err.message : String(err));
                    process.exit(1);
                }

                // Start dev server (stays alive) — it will auto-launch the app
                const { startDevServer } = await import('./dev-server.js');
                await startDevServer({
                    cwd: ctx.cwd,
                    logger: ctx.logger,
                    launchBundleId: bundleId,
                    iosSimulatorName: target.kind === 'simulator' ? target.name : undefined,
                    verbose,
                });
            },
        },
    },
});
