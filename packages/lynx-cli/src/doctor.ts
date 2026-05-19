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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAdbAvailable, listAndroidDevices, isLynxGoInstalled } from './device-detect';
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

function checkNode(): Check {
    const version = process.version;
    const major = parseInt(version.slice(1), 10);

    if (major >= 18) {
        return { name: 'Node.js', status: 'ok', message: `${version}` };
    } else if (major >= 16) {
        return { name: 'Node.js', status: 'warn', message: `${version} (18+ recommended)` };
    } else {
        return { name: 'Node.js', status: 'error', message: `${version} (18+ required)` };
    }
}

function checkPackageManager(): Check {
    const pnpm = getCommandVersion('pnpm --version');
    if (pnpm) return { name: 'pnpm', status: 'ok', message: `v${pnpm}` };

    const npm = getCommandVersion('npm --version');
    if (npm) return { name: 'npm', status: 'ok', message: `v${npm}` };

    return { name: 'Package manager', status: 'error', message: 'Neither pnpm nor npm found' };
}

function checkAndroidSdk(): Check {
    // Honour env vars first, then fall back to the canonical macOS/Linux location
    // so the check agrees with what `android-run.ts` resolves at build time.
    let androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

    if (!androidHome) {
        const home = process.env.HOME ?? '';
        const guesses = [
            process.platform === 'darwin' ? join(home, 'Library/Android/sdk') : null,
            process.platform === 'linux' ? join(home, 'Android/Sdk') : null,
        ].filter((p): p is string => !!p);
        for (const g of guesses) {
            if (existsSync(join(g, 'platform-tools'))) { androidHome = g; break; }
        }
    }

    if (!androidHome) {
        return {
            name: 'Android SDK',
            status: 'warn',
            message: 'ANDROID_HOME not set',
            detail: 'Set ANDROID_HOME environment variable to your Android SDK path',
        };
    }

    if (!existsSync(androidHome)) {
        return {
            name: 'Android SDK',
            status: 'error',
            message: `ANDROID_HOME points to missing directory: ${androidHome}`,
        };
    }

    // Check for build tools
    const buildToolsDir = join(androidHome, 'build-tools');
    const hasBuildTools = existsSync(buildToolsDir);

    // Check for platform tools
    const platformToolsDir = join(androidHome, 'platform-tools');
    const hasPlatformTools = existsSync(platformToolsDir);

    if (hasBuildTools && hasPlatformTools) {
        return { name: 'Android SDK', status: 'ok', message: androidHome };
    }

    return {
        name: 'Android SDK',
        status: 'warn',
        message: `${androidHome} (missing ${!hasBuildTools ? 'build-tools' : 'platform-tools'})`,
    };
}

function checkJdk(): Check {
    // Try candidates in the same order `android-run.ts:resolveJdkEnv` does so
    // the doctor never flags "Not found" on a machine where the CLI will
    // transparently pick up Android Studio's bundled JBR at build time.
    const candidates: Array<{ bin: string; source: string }> = [];
    if (process.env.JAVA_HOME) {
        candidates.push({ bin: join(process.env.JAVA_HOME, 'bin', 'java'), source: process.env.JAVA_HOME });
    }
    candidates.push({ bin: 'java', source: '$PATH' });
    const home = process.env.HOME ?? '';
    for (const jbr of [
        '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
        '/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home',
        join(home, 'Applications/Android Studio.app/Contents/jbr/Contents/Home'),
    ]) {
        candidates.push({ bin: join(jbr, 'bin', 'java'), source: jbr });
    }

    for (const c of candidates) {
        const q = c.bin === 'java' ? 'java' : `"${c.bin}"`;
        const out = getCommandVersion(`${q} -version 2>&1`);
        if (!out) continue;
        const match = out.match(/version "?(\d+)/);
        const major = match ? parseInt(match[1], 10) : 0;
        if (major === 0) continue;
        const label = c.source === '$PATH' ? `JDK ${major}` : `JDK ${major} (${c.source})`;
        if (major >= 17) return { name: 'JDK', status: 'ok', message: label };
        if (major >= 11) return { name: 'JDK', status: 'warn', message: `${label} — 17+ recommended` };
        return { name: 'JDK', status: 'error', message: `${label} — 17+ required` };
    }

    return { name: 'JDK', status: 'warn', message: 'Not found (install Android Studio for bundled JDK, or `brew install --cask temurin`)' };
}

function checkAdb(): Check {
    if (!isAdbAvailable()) {
        return { name: 'ADB', status: 'warn', message: 'Not found (install Android SDK platform-tools)' };
    }

    const devices = listAndroidDevices();
    if (devices.length === 0) {
        return { name: 'ADB', status: 'ok', message: 'Available (no devices connected)' };
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

    return {
        name: 'sigx-lynx-go',
        status: 'warn',
        message: 'Not installed on any connected device',
        detail: 'Build and install sigx-lynx-go from go/ via `pnpm sigx dev`',
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
 * Run all doctor checks and print results.
 */
export async function runDoctor(cwd: string, logger: Logger): Promise<void> {
    console.log('\n  \x1b[1msigx doctor\x1b[0m\n');
    console.log('  Checking your development environment...\n');

    const sections: { title: string; checks: Check[] }[] = [
        {
            title: 'Runtime',
            checks: [checkNode(), checkPackageManager()],
        },
        {
            title: 'Android',
            checks: [checkAndroidSdk(), checkJdk(), checkAdb()],
        },
        {
            title: 'iOS',
            checks: [checkXcode(), checkCocoaPods()],
        },
        {
            title: 'Lynx',
            checks: [checkRspeedy(), checkProjectConfig(cwd), checkLynxGoApp()],
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
}
