/**
 * sigx doctor — Environment validation for Lynx development.
 *
 * Checks that all prerequisites are installed and configured:
 * - Node.js version
 * - Package manager
 * - Android SDK / JDK
 * - Xcode / CocoaPods
 * - sigx-lynx-go on connected devices
 * - Project config validity
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isAdbAvailable, listAndroidDevices, isLynxGoInstalled, getDeviceCpuAbi } from './device-detect.js';
import { detectFromLockfile, getVersion as getPmVersion, detectFromBinaries } from './util/package-manager.js';
import { collectLynxVersions, assessLynxVersions, compareSemver } from './util/lynx-versions.js';
import { fetchLatestVersion } from './util/registry.js';
import { defaultAndroidSdkRoots } from './util/android-sdk.js';
import { checkCoreCompat, checkHostCompat } from './util/core-compat.js';
import { GRADLE_WRAPPER_VERSION, isSupportedJdk, resolveJdk, supportedRangeLabel, type JdkInfo } from './util/jdk.js';
import type { Logger } from '@sigx/cli/plugin';

interface Check {
    name: string;
    status: 'ok' | 'warn' | 'error' | 'skip';
    message: string;
    detail?: string;
}

function getCommandVersion(cmd: string): string | null {
    try {
        return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

/** Oldest Node major the toolchain supports (`@sigx/lynx-plugin` engines). */
export const MIN_NODE_MAJOR = 22;

export function checkNode(version: string = process.version): Check {
    const major = parseInt(version.slice(1), 10);
    if (major >= MIN_NODE_MAJOR) {
        return { name: 'Node.js', status: 'ok', message: version };
    }
    return {
        name: 'Node.js',
        status: 'error',
        message: `${version} (${MIN_NODE_MAJOR}+ required)`,
        detail: `fix: install Node.js ${MIN_NODE_MAJOR} LTS or newer from https://nodejs.org`,
    };
}

function checkPackageManager(cwd: string): Check {
    // If the project has a lockfile, that's the source of truth for which
    // tool owns it. Otherwise fall back to first-available on the machine.
    const fromLock = detectFromLockfile(cwd);
    if (fromLock) {
        const version = getPmVersion(fromLock);
        if (version) return { name: fromLock, status: 'ok', message: `v${version}` };
        return {
            name: fromLock,
            status: 'error',
            message: `Project uses ${fromLock} (lockfile present), but binary not found`,
        };
    }

    const available = detectFromBinaries();
    if (available) {
        const version = getPmVersion(available);
        return { name: available, status: 'ok', message: version ? `v${version}` : 'available' };
    }
    return { name: 'Package manager', status: 'error', message: 'No package manager found (pnpm, npm, yarn, or bun)' };
}

function checkAndroidSdk(): Check {
    // Env vars first, then Android Studio's default install location — the
    // same order `android-run.ts` resolves at build time.
    // Both variables are honoured; report whichever one is actually set.
    const envVar = process.env.ANDROID_HOME ? 'ANDROID_HOME' : process.env.ANDROID_SDK_ROOT ? 'ANDROID_SDK_ROOT' : null;
    let androidHome = envVar ? process.env[envVar] : undefined;
    const fromEnv = !!androidHome;

    if (!androidHome) {
        androidHome = defaultAndroidSdkRoots().find((g) => existsSync(join(g, 'platform-tools')));
    }

    if (!androidHome) {
        return {
            name: 'Android SDK',
            status: 'warn',
            message: 'Not found',
            detail: `fix: install Android Studio and finish its setup wizard (it installs the SDK to ${defaultAndroidSdkRoots()[0]}), or set ANDROID_HOME (or ANDROID_SDK_ROOT)`,
        };
    }

    if (!existsSync(androidHome)) {
        return {
            name: 'Android SDK',
            status: 'error',
            message: `${envVar} points to missing directory: ${androidHome}`,
            detail: `fix: point ${envVar} at your SDK folder (Android Studio → Settings → Android SDK shows it)`,
        };
    }

    const hasBuildTools = existsSync(join(androidHome, 'build-tools'));
    const hasPlatformTools = existsSync(join(androidHome, 'platform-tools'));

    if (hasBuildTools && hasPlatformTools) {
        return { name: 'Android SDK', status: 'ok', message: fromEnv ? androidHome : `${androidHome} (detected; ANDROID_HOME / ANDROID_SDK_ROOT not set)` };
    }

    return {
        name: 'Android SDK',
        status: 'warn',
        message: `${androidHome} (missing ${!hasBuildTools ? 'build-tools' : 'platform-tools'})`,
        detail: 'fix: Android Studio → Settings → Android SDK → SDK Tools → install Build-Tools and Platform-Tools',
    };
}

function jdkLabel(j: JdkInfo): string {
    const where = j.source === 'Android Studio' ? "Android Studio's JDK" : j.source;
    return `JDK ${j.major} (${where}${j.home ? `: ${j.home}` : ''})`;
}

/**
 * Classify the JDK situation exactly the way `android-run.ts` will act on
 * it — both go through `resolveJdk()`, so doctor's verdict is what gradle
 * will actually run on.
 */
export function classifyJdk(res: ReturnType<typeof resolveJdk>): Check {
    const range = supportedRangeLabel();
    if (res.chosen) {
        const skipped = res.found.filter((j) => j !== res.chosen && !isSupportedJdk(j.major));
        if (skipped.length === 0) return { name: 'JDK', status: 'ok', message: jdkLabel(res.chosen) };
        return {
            name: 'JDK',
            status: 'warn',
            message: `${skipped.map(jdkLabel).join(', ')} can't run Gradle ${GRADLE_WRAPPER_VERSION} — sigx will use ${jdkLabel(res.chosen)} instead`,
            detail: `fix (optional): point JAVA_HOME at a JDK ${range} to silence this`,
        };
    }
    if (res.found.length > 0) {
        return {
            name: 'JDK',
            status: 'error',
            message: `${res.found.map(jdkLabel).join(', ')} — Android builds need JDK ${range}`,
            detail: `fix: install Android Studio (its bundled JDK is picked up automatically), or set JAVA_HOME to a JDK ${range}`,
        };
    }
    return {
        name: 'JDK',
        status: 'warn',
        message: 'Not found',
        detail: `fix: install Android Studio (its bundled JDK is picked up automatically), or a JDK ${range}`,
    };
}

function checkJdk(): Check {
    return classifyJdk(resolveJdk());
}

// target-picker pulls in @sigx/terminal (and through it @sigx/runtime-core):
// imported lazily so doctor still runs — and reports it — when core is broken.
async function checkEmulators(adbOk: boolean): Promise<Check> {
    if (!adbOk) return { name: 'Emulators', status: 'skip', message: 'ADB not available' };
    let avds: string[] = [];
    try {
        const { listAndroidAvds } = await import('./target-picker.js');
        avds = listAndroidAvds();
    } catch {
        return { name: 'Emulators', status: 'skip', message: 'could not list emulators' };
    }
    if (avds.length > 0) {
        return { name: 'Emulators', status: 'ok', message: avds.join(', ') };
    }
    return {
        name: 'Emulators',
        status: 'warn',
        message: 'No Android emulators (AVDs) found',
        detail: 'fix: Android Studio → Device Manager → Create Virtual Device — or use a phone with USB debugging',
    };
}

/** Core (`@sigx/runtime-core`, `@sigx/reactivity`) and sigx host versions vs. what the lynx packages need. */
function checkInstallCompat(cwd: string, hostVersion: string | undefined): Check {
    const issues = checkCoreCompat(cwd);
    const host = checkHostCompat(cwd, hostVersion);
    if (host) issues.push(host);
    if (issues.length === 0) {
        return { name: '@sigx core versions', status: 'ok', message: 'match the installed @sigx/lynx-* packages' };
    }
    return {
        name: '@sigx core versions',
        status: 'error',
        message: issues.map((i) => `${i.pkg} ${i.installed} installed, ${i.requiredBy} needs ${i.required}`).join('; '),
        detail: 'fix: npx sigx upgrade   (updates @sigx/lynx-* and the matching core packages together)',
    };
}

function checkAdb(): Check {
    if (!isAdbAvailable()) {
        return {
            name: 'ADB',
            status: 'warn',
            message: 'Not found',
            detail: 'fix: Android Studio → Settings → Android SDK → SDK Tools → install Android SDK Platform-Tools',
        };
    }

    const devices = listAndroidDevices();
    if (devices.length === 0) {
        return { name: 'ADB', status: 'ok', message: 'Available (no devices connected)' };
    }

    // x86_64 emulators can't render Lynx `<svg>` (icons): upstream servalsvg
    // ships no x86_64 native lib (signalxjs/lynx#270). Surface it here so the
    // blank-icons symptom is diagnosable before anyone chases it as an app bug.
    const x64 = devices.filter((d) => getDeviceCpuAbi(d.id) === 'x86_64');
    if (x64.length > 0) {
        return {
            name: 'ADB',
            status: 'warn',
            message: `${devices.length} device(s) connected — ${x64.map((d) => d.model || d.id).join(', ')} ${x64.length === 1 ? 'is' : 'are'} x86_64`,
            detail: 'Lynx SVG icons render blank on x86_64 emulators — upstream native-lib gap, see https://github.com/signalxjs/lynx/issues/270. Use an arm64 device/AVD to verify icons.',
        };
    }

    return {
        name: 'ADB',
        status: 'ok',
        message: `${devices.length} device(s) connected`,
    };
}

function checkXcode(): Check {
    if (process.platform !== 'darwin') {
        return { name: 'Xcode', status: 'skip', message: 'N/A (macOS only)' };
    }

    const version = getCommandVersion('xcodebuild -version 2>/dev/null');
    if (!version) {
        return { name: 'Xcode', status: 'warn', message: 'Not found' };
    }

    return { name: 'Xcode', status: 'ok', message: version.split('\n')[0] };
}

function checkCocoaPods(): Check {
    if (process.platform !== 'darwin') {
        return { name: 'CocoaPods', status: 'skip', message: 'N/A (macOS only)' };
    }

    const version = getCommandVersion('pod --version');
    if (!version) {
        return { name: 'CocoaPods', status: 'warn', message: 'Not found (required for iOS builds)' };
    }

    return { name: 'CocoaPods', status: 'ok', message: `v${version}` };
}

function checkLynxGoApp(): Check {
    if (!isAdbAvailable()) {
        return { name: 'sigx-lynx-go', status: 'skip', message: 'ADB not available' };
    }

    const devices = listAndroidDevices();
    if (devices.length === 0) {
        return { name: 'sigx-lynx-go', status: 'skip', message: 'No devices connected' };
    }

    const installed: string[] = [];
    const notInstalled: string[] = [];

    for (const device of devices) {
        if (isLynxGoInstalled(device.id)) {
            installed.push(device.model || device.id);
        } else {
            notInstalled.push(device.model || device.id);
        }
    }

    if (installed.length > 0 && notInstalled.length === 0) {
        return {
            name: 'sigx-lynx-go',
            status: 'ok',
            message: `Installed on ${installed.join(', ')}`,
        };
    } else if (installed.length > 0) {
        return {
            name: 'sigx-lynx-go',
            status: 'warn',
            message: `Installed on ${installed.join(', ')}, missing on ${notInstalled.join(', ')}`,
        };
    }

    // The sandbox app is optional: `sigx run:android` / `sigx dev` build and
    // install the project's own app (with the dev client), which is the
    // normal path. Not having the sandbox is not a problem worth a warning.
    return {
        name: 'sigx-lynx-go',
        status: 'skip',
        message: 'not installed (optional sandbox app — `npx sigx run:android` installs your own app instead)',
    };
}

function checkProjectConfig(cwd: string): Check {
    const configFiles = [
        'signalx.config.ts',
        'signalx.config.js',
        'signalx.config.mjs',
        'lynx.config.ts',
        'lynx.config.js',
    ];

    const found = configFiles.find((f) => existsSync(join(cwd, f)));

    if (!found) {
        return {
            name: 'Lynx config',
            status: 'warn',
            message: 'No signalx.config.ts found',
            detail: 'Create signalx.config.ts with defineLynxConfig()',
        };
    }

    return { name: 'Lynx config', status: 'ok', message: found };
}

function checkRspeedy(): Check {
    // `rspeedy --version` exits with code 1 upstream even on success (it also
    // prints the version banner), so `execSync` throws. Inspect stdout either
    // way and pull the version string when it's present.
    let stdout = '';
    try {
        stdout = execSync('npx rspeedy --version 2>&1', { stdio: 'pipe', encoding: 'utf-8' });
    } catch (err) {
        stdout = (err as { stdout?: Buffer | string }).stdout?.toString() ?? '';
    }
    const match = stdout.match(/\b(\d+\.\d+\.\d+)\b/);
    if (match) {
        return { name: 'rspeedy', status: 'ok', message: `v${match[1]}` };
    }
    return { name: 'rspeedy', status: 'warn', message: 'Not found (required for Lynx development)' };
}

function formatCheck(check: Check): string {
    const icons = {
        ok: '\x1b[32m✓\x1b[0m',
        warn: '\x1b[33m!\x1b[0m',
        error: '\x1b[31m✗\x1b[0m',
        skip: '\x1b[2m–\x1b[0m',
    };

    const icon = icons[check.status];
    let line = `  ${icon} ${check.name}: ${check.message}`;

    if (check.detail) {
        line += `\n      \x1b[2m${check.detail}\x1b[0m`;
    }

    return line;
}

/**
 * `@sigx/lynx-*` are lockstep — they must all be the same version, and ideally
 * the latest release (stale versions miss fixes like #342, where an old
 * `@sigx/lynx-http` made `res.ok` false on real 200s → cryptic "network error").
 * Errors on version skew; warns when behind the latest published release.
 */
function checkSigxLynxVersions(cwd: string): Check {
    const name = '@sigx/lynx-* versions';
    const verdict = assessLynxVersions(collectLynxVersions(cwd));
    if (verdict.kind === 'none') {
        return { name, status: 'skip', message: 'no @sigx/lynx-* packages installed' };
    }
    if (verdict.kind === 'skew') {
        const detail = verdict.groups.map((g) => `${g.version}×${g.names.length}`).join(', ');
        return {
            name,
            status: 'error',
            message: `version skew (${detail}) — these are lockstep and MUST all match.`,
            detail: verdict.groups.map((g) => `  ${g.version}: ${g.names.join(', ')}`).join('\n') + '\nfix: npx sigx upgrade',
        };
    }
    // Aligned — best-effort staleness check against the registry. `npm view`
    // can throw (offline / not published / timeout) — treat any failure as
    // "can't tell" and report ok rather than failing the doctor run.
    let latest: string | undefined;
    try {
        latest = fetchLatestVersion('@sigx/lynx', { timeoutMs: 4000 });
    } catch {
        latest = undefined;
    }
    if (latest && compareSemver(latest, verdict.version) > 0) {
        return {
            name,
            status: 'warn',
            message: `on ${verdict.version}; ${latest} is published`,
            detail: 'fix: npx sigx upgrade   (then rebuild the native app for native fixes)',
        };
    }
    return { name, status: 'ok', message: `all aligned at ${verdict.version}` };
}

/**
 * Run all doctor checks and print results.
 */
export async function runDoctor(cwd: string, logger: Logger, hostVersion?: string): Promise<{ errors: number; warnings: number }> {
    console.log('\n  \x1b[1msigx doctor\x1b[0m\n');
    console.log('  Checking your development environment...\n');

    const lynxVersions = checkSigxLynxVersions(cwd);
    const adb = checkAdb();

    const sections: { title: string; checks: Check[] }[] = [
        {
            title: 'Runtime',
            checks: [checkNode(), checkPackageManager(cwd)],
        },
        {
            title: 'Android',
            checks: [checkAndroidSdk(), checkJdk(), adb, await checkEmulators(isAdbAvailable())],
        },
        {
            title: 'iOS',
            checks: [checkXcode(), checkCocoaPods()],
        },
        {
            title: 'Lynx',
            checks: [checkRspeedy(), lynxVersions, checkInstallCompat(cwd, hostVersion), checkProjectConfig(cwd), checkLynxGoApp()],
        },
    ];

    let totalOk = 0;
    let totalWarn = 0;
    let totalError = 0;

    for (const section of sections) {
        console.log(`  \x1b[1m${section.title}\x1b[0m`);
        for (const check of section.checks) {
            console.log(formatCheck(check));
            if (check.status === 'ok') totalOk++;
            else if (check.status === 'warn') totalWarn++;
            else if (check.status === 'error') totalError++;
        }
        console.log('');
    }

    // Summary
    const parts: string[] = [];
    if (totalOk > 0) parts.push(`\x1b[32m${totalOk} passed\x1b[0m`);
    if (totalWarn > 0) parts.push(`\x1b[33m${totalWarn} warnings\x1b[0m`);
    if (totalError > 0) parts.push(`\x1b[31m${totalError} errors\x1b[0m`);

    console.log(`  Summary: ${parts.join(' · ')}`);

    if (totalError > 0) {
        console.log('  \x1b[31mSome issues must be fixed before you can develop.\x1b[0m');
    } else if (totalWarn > 0) {
        console.log('  \x1b[33mSome optional tools are missing — you can still develop.\x1b[0m');
    } else {
        console.log('  \x1b[32mAll good! Ready to develop with sigx-lynx.\x1b[0m');
    }

    console.log('');
    return { errors: totalError, warnings: totalWarn };
}
