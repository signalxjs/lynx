/**
 * Shared iOS build + install orchestration.
 *
 * Used by both `sigx run:ios` and `sigx dev` (when the user picks an iOS
 * target). The caller is responsible for resolving and booting the target
 * — this helper only runs prebuild, pods, xcodebuild, and the install.
 * Launching is deliberately left to the dev server's auto-launch loop so
 * `sigx dev` can launch every picked target at once with the right URL.
 */

import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import { iosDirName } from './config/paths.js';
import { runPrebuild } from './prebuild.js';
import { podInstallIfStale } from './ios-pods.js';
import { runWithBuildFilter } from './build-output.js';
import {
    findBuiltApp,
    getInstalledAppContainer,
    installAppOnDevice,
    installAppOnSimulator,
    iosDerivedDataPath,
    isAppInstalledOnDevice,
} from './device-detect.js';
import {
    fingerprintIosBuild,
    readCachedFingerprint,
    writeCachedFingerprint,
} from './util/build-fingerprint.js';
import { sameAppBinary } from './util/app-identity.js';

export type IosBuildTarget =
    | { kind: 'simulator'; udid: string; name: string }
    | { kind: 'device'; udid: string; name: string };

export interface EnsureIosBuiltOptions {
    cwd: string;
    logger: Logger;
    appName: string;
    target: IosBuildTarget;
    /**
     * App bundle identifier. When provided, enables the "already up to date"
     * fast path — we check whether the app is still installed on `target` and
     * skip xcodebuild + install when the build-input fingerprint matches the
     * last successful install.
     */
    bundleId?: string;
    configuration?: 'Debug' | 'Release';
    verbose?: boolean;
    /** Build variant (#530) — selects the `ios-<variant>/` output dir. */
    variant?: string;
}

function iosFingerprintKey(target: IosBuildTarget, configuration: string, variant?: string): string {
    return `ios-${variant ? `${variant}-` : ''}${configuration.toLowerCase()}-${target.kind}-${target.udid}`;
}

export async function ensureIosBuilt(opts: EnsureIosBuiltOptions): Promise<void> {
    const { cwd, logger, appName, target, bundleId, configuration = 'Debug', verbose = false, variant } = opts;
    const iosDirRel = iosDirName(variant);
    const iosDir = join(cwd, iosDirRel);

    logger.log('Running prebuild for iOS...');
    await runPrebuild({ android: false, ios: true, cwd, variant });

    // Fast path: if the build-input fingerprint matches what we stored after
    // the last successful install AND the app on the target is provably OURS,
    // skip pod install / xcodebuild / install entirely. The dev-server's
    // auto-launch loop will (re)launch with the fresh dev URL.
    if (bundleId) {
        const fingerprint = fingerprintIosBuild(cwd, appName, configuration, variant);
        const cacheKey = iosFingerprintKey(target, configuration, variant);
        const cached = readCachedFingerprint(cwd, cacheKey);
        if (cached === fingerprint) {
            let upToDate: boolean;
            if (target.kind === 'simulator') {
                // Identity-aware skip (#178): a matching fingerprint only
                // proves THIS checkout's inputs haven't changed — another
                // checkout of the same app (same bundle id) may have installed
                // ITS binary over ours since. The simulator's app container is
                // a plain host directory, so compare the installed executable
                // against our local build products and skip only when they're
                // byte-identical.
                const installedApp = getInstalledAppContainer(target.udid, bundleId);
                const localApp = findBuiltApp(cwd, appName, 'simulator', configuration, variant);
                upToDate = installedApp !== null && localApp !== null
                    && sameAppBinary(installedApp, localApp);
            } else {
                // Physical devices: the installed bundle isn't host-readable
                // via devicectl, so the identity check isn't possible — keep
                // the is-installed probe. A cross-checkout overwrite on a
                // device can still defeat this (documented limitation, #178).
                upToDate = isAppInstalledOnDevice(target.udid, bundleId);
            }
            if (upToDate) {
                logger.log(`\x1b[32m✓ ${target.name} up to date — skipping build\x1b[0m`);
                return;
            }
        }
    }

    await podInstallIfStale(iosDir, logger);

    logger.log(`Building iOS (${configuration}) for ${target.kind}...`);
    const workspace = join(iosDirRel, `${appName}.xcworkspace`);
    try {
        await runWithBuildFilter(
            'xcodebuild',
            [
                '-workspace', workspace,
                '-scheme', appName,
                '-destination', `id=${target.udid}`,
                '-configuration', configuration,
                // Project-local products dir — two checkouts sharing a scheme
                // name must never resolve each other's .app (#178).
                '-derivedDataPath', iosDerivedDataPath(cwd, variant),
                'build',
            ],
            { cwd },
            { kind: 'xcodebuild', verbose, logger },
        );
    } catch {
        if (target.kind === 'device') {
            logger.error('Device build failed. Check that a development team is selected in Xcode (Signing & Capabilities).');
        }
        throw new Error(`iOS ${configuration} build failed`);
    }

    logger.log('\x1b[32m✓ App built\x1b[0m');

    const buildTarget = target.kind === 'device' ? 'device' : 'simulator';
    const appPath = findBuiltApp(cwd, appName, buildTarget, configuration, variant);
    if (!appPath) {
        throw new Error(`Could not find built ${appName}.app in ${iosDirRel}/build (${buildTarget}, ${configuration})`);
    }

    logger.log(`Installing on ${target.kind} (${target.name})...`);
    const installed = target.kind === 'device'
        ? installAppOnDevice(target.udid, appPath)
        : installAppOnSimulator(target.udid, appPath);
    if (!installed) {
        if (target.kind === 'device') {
            logger.error('Ensure the device is unlocked, trusted, and Developer Mode is enabled.');
        }
        throw new Error(`Failed to install app on ${target.kind}`);
    }
    logger.log('\x1b[32m✓ App installed\x1b[0m');

    // Record what we just installed so the next run can short-circuit when
    // nothing changed. Fingerprint is computed AFTER prebuild + xcodebuild,
    // which is fine — prebuild's outputs are deterministic for a given
    // config, and xcodebuild itself doesn't modify input sources.
    if (bundleId) {
        const fingerprint = fingerprintIosBuild(cwd, appName, configuration, variant);
        writeCachedFingerprint(cwd, iosFingerprintKey(target, configuration, variant), fingerprint);
    }
}
