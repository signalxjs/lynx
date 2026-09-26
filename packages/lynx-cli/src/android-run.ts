/**
 * Shared Android build + install orchestration.
 *
 * Used by both `sigx run:android` (dedicated command) and `sigx dev` (when
 * the user picks an Android target). Extracted so the two code paths stay
 * in sync. The ensure-built helper is idempotent — gradle handles
 * incremental builds itself.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import { androidDirName } from './config/paths.js';
import { runPrebuild } from './prebuild.js';
import { resolveAdb, isAppInstalled, pingDevice } from './device-detect.js';
import { runWithBuildFilter } from './build-output.js';
import { defaultAndroidSdkRoots } from './util/android-sdk.js';
import { describeJdkFallback, describeNoSupportedJdk, jdkEnv, resolveJdk } from './util/jdk.js';
import { diagnoseGradleFailure, formatGradleFailure } from './util/gradle-diagnose.js';
import {
    fingerprintAndroidBuild,
    readCachedFingerprint,
    writeCachedFingerprint,
} from './util/build-fingerprint.js';

/**
 * Discover the Android SDK root. Mirrors the candidate list in
 * {@link resolveAdb} so a machine with no `ANDROID_HOME` exported still
 * works as long as the SDK is in one of the standard locations (including
 * Android Studio's default `%LOCALAPPDATA%\Android\Sdk` on Windows).
 */
export function resolveAndroidSdk(): string | null {
    if (process.env.ANDROID_HOME && existsSync(join(process.env.ANDROID_HOME, 'platform-tools'))) {
        return process.env.ANDROID_HOME;
    }
    if (process.env.ANDROID_SDK_ROOT && existsSync(join(process.env.ANDROID_SDK_ROOT, 'platform-tools'))) {
        return process.env.ANDROID_SDK_ROOT;
    }
    const adb = resolveAdb();
    if (adb && adb !== 'adb') {
        const sdk = adb.replace(/[\\/]platform-tools[\\/]adb(\.exe)?$/i, '');
        if (existsSync(join(sdk, 'platform-tools'))) return sdk;
    }
    for (const g of defaultAndroidSdkRoots()) {
        if (existsSync(join(g, 'platform-tools'))) return g;
    }
    return null;
}

/**
 * Resolve the JDK + Android SDK env block used by every gradle invocation
 * in this CLI. Every gradle spawn (run:android dev + --release, and the dev
 * dashboard's installs) must pass this as `env:` so gradle runs on a
 * supported JDK — falling back to Android Studio's bundled JBR when
 * JAVA_HOME / PATH point at one Gradle can't run — and finds the SDK on
 * machines where neither env var is set.
 *
 * Throws with an actionable message when either can't be resolved.
 */
export function resolveAndroidBuildEnv(logger: Pick<Logger, 'log'>): NodeJS.ProcessEnv {
    return resolveAndroidBuild(logger).env;
}

function resolveAndroidBuild(logger: Pick<Logger, 'log'>): { env: NodeJS.ProcessEnv; jdkMajor: number } {
    const jdk = resolveJdk();
    if (!jdk.chosen) {
        throw new Error(describeNoSupportedJdk(jdk));
    }
    const fallback = describeJdkFallback(jdk);
    if (fallback) logger.log(fallback);

    const androidSdk = resolveAndroidSdk();
    if (!androidSdk) {
        const [defaultRoot] = defaultAndroidSdkRoots();
        throw new Error(
            'Android SDK not found.\n' +
            '  Install it with Android Studio (first-run setup wizard, or Settings → Android SDK),\n' +
            `  or set ANDROID_HOME to your SDK folder (Android Studio's default is ${defaultRoot}).\n` +
            '  Then run `npx sigx doctor` to confirm.',
        );
    }
    if (process.env.ANDROID_HOME !== androidSdk) {
        logger.log(`Using Android SDK at ${androidSdk}`);
    }

    return {
        env: {
            ...jdkEnv(jdk.chosen),
            ANDROID_HOME: androidSdk,
            ANDROID_SDK_ROOT: androidSdk,
        },
        jdkMajor: jdk.chosen.major,
    };
}

/**
 * Run gradle with the canonical build env. On failure, the raw output is
 * matched against known failure shapes (JDK too new, SDK missing, licenses,
 * signature mismatch, no device, …) and the thrown error carries gradle's
 * reason plus a concrete fix — instead of a bare "Android build failed".
 *
 * Output is filtered through {@link runWithBuildFilter} (gradle kind) by
 * default; `verbose` restores raw streaming. The diagnosis reads unfiltered
 * chunks via `onChunk`, so it works in both modes. Pass `sink` to route
 * the build's lines somewhere other than stdout (the dev dashboard).
 */
export async function runGradleWithDx(
    args: string[],
    opts: {
        cwd: string;
        logger: Pick<Logger, 'log'>;
        applicationId?: string;
        verbose?: boolean;
        sink?: (line: string) => void;
    },
): Promise<void> {
    const { env, jdkMajor } = resolveAndroidBuild(opts.logger);
    const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';

    // Keep the tail of the output for diagnosis — the failure block is at
    // the end, and a cold build can print tens of MB before it.
    const TAIL_LIMIT = 256 * 1024;
    let tail = '';

    try {
        await runWithBuildFilter(
            join(opts.cwd, gradleCmd),
            args,
            { cwd: opts.cwd, env },
            {
                kind: 'gradle',
                verbose: opts.verbose ?? false,
                logger: opts.logger as Logger,
                sink: opts.sink,
                onChunk: (chunk) => {
                    tail += chunk.toString('utf-8');
                    if (tail.length > TAIL_LIMIT) tail = tail.slice(-TAIL_LIMIT);
                },
            },
        );
    } catch (err) {
        const diag = diagnoseGradleFailure(tail, { applicationId: opts.applicationId, jdkMajor });
        // Spawn-level failure (gradlew missing / not executable) — no output.
        if (!diag.reason && !diag.hint && tail.trim() === '') {
            throw new Error(
                `Android build failed: could not run ${join(opts.cwd, gradleCmd)} (${err instanceof Error ? err.message : String(err)}).\n` +
                '  Regenerate the native project with `npx sigx prebuild --android --clean`, then re-run.',
            );
        }
        throw new Error(formatGradleFailure(diag, { verbose: opts.verbose }));
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
    /** Build variant (#530) — selects the `android-<variant>/` output dir. */
    variant?: string;
}

function androidFingerprintKey(variant?: string): string {
    // Gradle installs to every connected device, so the fingerprint isn't
    // per-device — we just track "what we last installed" alongside which
    // devices it landed on (checked separately via adb).
    return variant ? `android-${variant}-debug` : `android-debug`;
}

/**
 * Runs prebuild for Android and `gradlew installDebug`. Throws if the
 * build fails. No-op / fast on subsequent calls thanks to gradle's
 * incremental build + install daemon — and skipped entirely when the
 * build-input fingerprint matches the last successful install AND the
 * app is still on every target device.
 */
export async function ensureAndroidBuilt(opts: EnsureAndroidBuiltOptions): Promise<void> {
    const { cwd, logger, applicationId, targetDeviceIds, variant } = opts;
    const androidDir = join(cwd, androidDirName(variant));

    logger.log('Running prebuild for Android...');
    await runPrebuild({ android: true, ios: false, cwd, variant });

    // Pre-flight: catch a wedged `adbd` (device shows as connected but
    // `adb shell` blocks) before it hangs the whole flow silently right after
    // prebuild. We only abort on a *timeout* — fast-fail states like
    // `unauthorized` (needs an on-screen prompt) or `offline` aren't hangs, so
    // we let them fall through to gradle, which reports them accurately.
    if (targetDeviceIds && targetDeviceIds.length > 0) {
        const wedged = targetDeviceIds.filter((id) => pingDevice(id).timedOut);
        if (wedged.length > 0) {
            throw new Error(
                `Android target${wedged.length > 1 ? 's' : ''} not responding: ` +
                `${wedged.join(', ')}.\n` +
                `The device is connected but its adb daemon is wedged. ` +
                `Try: replug USB (tap "Allow" if prompted), toggle USB debugging off/on, ` +
                `or run \`adb kill-server && adb start-server\` — then re-run.`,
            );
        }
    }

    // Fast path: skip gradle if nothing relevant changed and the app is
    // already installed on every target. Cheap (a few stat + sha256 of small
    // files, plus one adb per target) compared to gradle's ~2-5s startup.
    if (applicationId && targetDeviceIds && targetDeviceIds.length > 0) {
        const fingerprint = fingerprintAndroidBuild(cwd, variant);
        const cached = readCachedFingerprint(cwd, androidFingerprintKey(variant));
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
        const fingerprint = fingerprintAndroidBuild(cwd, variant);
        writeCachedFingerprint(cwd, androidFingerprintKey(variant), fingerprint);
    }
}
