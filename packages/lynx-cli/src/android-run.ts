/**
 * Shared Android build + install orchestration.
 *
 * Used by both `sigx run:android` (dedicated command) and `sigx dev` (when
 * the user picks an Android target). Extracted so the two code paths stay
 * in sync. The ensure-built helper is idempotent — gradle handles
 * incremental builds itself.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import { runPrebuild } from './prebuild.js';
import { resolveAdb, isAppInstalled } from './device-detect.js';
import { runWithBuildFilter } from './build-output.js';
import {
    fingerprintAndroidBuild,
    readCachedFingerprint,
    writeCachedFingerprint,
} from './util/build-fingerprint.js';

/**
 * Discover the Android SDK root. Mirrors the candidate list in
 * {@link resolveAdb} so a machine with no `ANDROID_HOME` exported still
 * works as long as the SDK is in one of the standard locations.
 */
function resolveAndroidSdk(): string | null {
    if (process.env.ANDROID_HOME && existsSync(join(process.env.ANDROID_HOME, 'platform-tools'))) {
        return process.env.ANDROID_HOME;
    }
    if (process.env.ANDROID_SDK_ROOT && existsSync(join(process.env.ANDROID_SDK_ROOT, 'platform-tools'))) {
        return process.env.ANDROID_SDK_ROOT;
    }
    const adb = resolveAdb();
    if (adb && adb !== 'adb') {
        const sdk = adb.replace(/[\\/]platform-tools[\\/]adb$/, '');
        if (existsSync(join(sdk, 'platform-tools'))) return sdk;
    }
    const home = process.env.HOME ?? '';
    const guesses = [
        process.platform === 'darwin' ? join(home, 'Library/Android/sdk') : null,
        process.platform === 'linux' ? join(home, 'Android/Sdk') : null,
    ].filter((p): p is string => !!p);
    for (const g of guesses) {
        if (existsSync(join(g, 'platform-tools'))) return g;
    }
    return null;
}

/**
 * Gradle needs a JDK. On stock macOS `/usr/bin/java` is a stub that prints
 * "Unable to locate a Java Runtime" — unhelpful. Before shelling out we
 * (a) honour an existing JAVA_HOME, (b) fall back to Android Studio's
 * bundled JBR on macOS, (c) fail with a clear pointer to `sigx doctor`.
 *
 * Returns the env block to pass to spawn(), with JAVA_HOME set when we
 * had to discover it ourselves. Returning `null` means no JDK found.
 */
function resolveJdkEnv(): NodeJS.ProcessEnv | null {
    // 1. Respect an existing working JAVA_HOME.
    if (process.env.JAVA_HOME) {
        const javaBin = join(process.env.JAVA_HOME, 'bin', 'java');
        if (existsSync(javaBin)) {
            try { execSync(`"${javaBin}" -version`, { stdio: 'pipe' }); return { ...process.env }; } catch { /* fall through */ }
        }
    }

    // 2. PATH-level java (Homebrew, manual install, etc.).
    try {
        execSync('java -version', { stdio: 'pipe' });
        return { ...process.env };
    } catch { /* fall through */ }

    // 3. Android Studio's bundled JBR (macOS).
    const candidates = [
        '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
        '/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home',
        join(process.env.HOME ?? '', 'Applications/Android Studio.app/Contents/jbr/Contents/Home'),
    ];
    for (const javaHome of candidates) {
        const javaBin = join(javaHome, 'bin', 'java');
        if (!existsSync(javaBin)) continue;
        try {
            execSync(`"${javaBin}" -version`, { stdio: 'pipe' });
            return { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}:${process.env.PATH ?? ''}` };
        } catch { /* try next */ }
    }

    return null;
}

/**
 * Resolve the JDK + Android SDK env block used by every gradle invocation
 * in this CLI. Both `sigx run:android` flows (dev + --release) must pass
 * this as `env:` to spawn so they pick up Android Studio's bundled JBR
 * and the canonical SDK path on machines where neither env var is set.
 *
 * Throws with an actionable message when either can't be resolved.
 */
export function resolveAndroidBuildEnv(logger: Logger): NodeJS.ProcessEnv {
    const jdkEnv = resolveJdkEnv();
    if (!jdkEnv) {
        throw new Error(
            'No Java runtime found. Android builds require a JDK (17+ recommended).\n' +
            '  Fastest fix:  install Android Studio (ships a bundled JDK we auto-detect)\n' +
            '  Or via Homebrew:  brew install --cask temurin\n' +
            '  Then run `sigx doctor` to confirm.',
        );
    }
    if (jdkEnv.JAVA_HOME !== process.env.JAVA_HOME) {
        logger.log(`Using JDK from ${jdkEnv.JAVA_HOME}`);
    }

    const androidSdk = resolveAndroidSdk();
    if (!androidSdk) {
        throw new Error(
            'Android SDK not found. Set ANDROID_HOME to your SDK root (commonly ~/Library/Android/sdk on macOS),\n' +
            '  or run `sigx doctor` for a full environment check.',
        );
    }
    if (process.env.ANDROID_HOME !== androidSdk) {
        logger.log(`Using Android SDK at ${androidSdk}`);
    }

    return {
        ...jdkEnv,
        ANDROID_HOME: androidSdk,
        ANDROID_SDK_ROOT: androidSdk,
    };
}

/**
 * Run gradle with the canonical build env and watch for common install
 * errors (signature mismatch, …) so we can surface a friendly follow-up
 * hint instead of burying the user under a 200-line stack trace.
 *
 * Output is filtered through {@link runWithBuildFilter} (gradle kind) by
 * default; `verbose` restores raw streaming for diagnostics. The
 * signature-mismatch sniffer runs against unfiltered chunks via `onChunk`
 * so it keeps working in both modes.
 */
export async function runGradleWithDx(
    args: string[],
    opts: { cwd: string; logger: Logger; applicationId?: string; verbose?: boolean },
): Promise<void> {
    const gradleEnv = resolveAndroidBuildEnv(opts.logger);
    const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';

    let sawSignatureMismatch = false;
    const SIG_PATTERN = /INSTALL_FAILED_UPDATE_INCOMPATIBLE.*signatures do not match/;

    try {
        await runWithBuildFilter(
            join(opts.cwd, gradleCmd),
            args,
            {
                cwd: opts.cwd,
                shell: process.platform === 'win32',
                env: gradleEnv,
            },
            {
                kind: 'gradle',
                verbose: opts.verbose ?? false,
                logger: opts.logger,
                onChunk: (chunk) => {
                    if (!sawSignatureMismatch && SIG_PATTERN.test(chunk.toString('utf-8'))) {
                        sawSignatureMismatch = true;
                    }
                },
            },
        );
    } catch {
        if (sawSignatureMismatch) {
            const pkg = opts.applicationId ?? '<your package>';
            opts.logger.error('');
            opts.logger.error('\x1b[33mInstall failed: signature mismatch.\x1b[0m An app with this package ID is already');
            opts.logger.error('installed on the device with a different signing key (common when switching from');
            opts.logger.error('sigx-lynx-go, between debug/release keystores, or across machines).');
            opts.logger.error('');
            opts.logger.error(`Fix:  adb uninstall ${pkg}`);
            opts.logger.error('Then re-run the same sigx command.');
            opts.logger.error('');
        }
        throw new Error('Android build failed');
    }
}

export interface EnsureAndroidBuiltOptions {
    cwd: string;
    logger: Logger;
    applicationId?: string;
    /**
     * Devices the app needs to end up installed on. When provided alongside
     * `applicationId`, enables the "already up to date" fast path: if the
     * build-input fingerprint matches the last successful install AND the
     * app is present on every target device, we skip gradle entirely.
     */
    targetDeviceIds?: string[];
    verbose?: boolean;
}

function androidFingerprintKey(): string {
    // Gradle installs to every connected device, so the fingerprint isn't
    // per-device — we just track "what we last installed" alongside which
    // devices it landed on (checked separately via adb).
    return `android-debug`;
}

/**
 * Runs prebuild for Android and `gradlew installDebug`. Throws if the
 * build fails. No-op / fast on subsequent calls thanks to gradle's
 * incremental build + install daemon — and skipped entirely when the
 * build-input fingerprint matches the last successful install AND the
 * app is still on every target device.
 */
export async function ensureAndroidBuilt(opts: EnsureAndroidBuiltOptions): Promise<void> {
    const { cwd, logger, applicationId, targetDeviceIds } = opts;
    const androidDir = join(cwd, 'android');

    logger.log('Running prebuild for Android...');
    await runPrebuild({ android: true, ios: false, cwd });

    // Fast path: skip gradle if nothing relevant changed and the app is
    // already installed on every target. Cheap (a few stat + sha256 of small
    // files, plus one adb per target) compared to gradle's ~2-5s startup.
    if (applicationId && targetDeviceIds && targetDeviceIds.length > 0) {
        const fingerprint = fingerprintAndroidBuild(cwd);
        const cached = readCachedFingerprint(cwd, androidFingerprintKey());
        if (cached === fingerprint) {
            const allInstalled = targetDeviceIds.every((id) => isAppInstalled(id, applicationId));
            if (allInstalled) {
                logger.log(`\x1b[32m✓ Android up to date — skipping build\x1b[0m`);
                return;
            }
        }
    }

    logger.log('Building Android (debug)...');
    await runGradleWithDx(['installDebug'], {
        cwd: androidDir,
        logger,
        applicationId,
        verbose: opts.verbose,
    });

    logger.log('\x1b[32m✓ App installed\x1b[0m');

    if (applicationId && targetDeviceIds && targetDeviceIds.length > 0) {
        const fingerprint = fingerprintAndroidBuild(cwd);
        writeCachedFingerprint(cwd, androidFingerprintKey(), fingerprint);
    }
}
