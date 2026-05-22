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
import { runPrebuild } from './prebuild.js';
import { podInstallIfStale } from './ios-pods.js';
import { runWithBuildFilter } from './build-output.js';
import {
    findBuiltApp,
    installAppOnDevice,
    installAppOnSimulator,
    isAppInstalledOnSimulator,
    isAppInstalledOnDevice,
} from './device-detect.js';
import {
    fingerprintIosBuild,
    readCachedFingerprint,
    writeCachedFingerprint,
} from './util/build-fingerprint.js';

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
}

function iosFingerprintKey(target: IosBuildTarget, configuration: string): string {
    return `ios-${configuration.toLowerCase()}-${target.kind}-${target.udid}`;
}

export async function ensureIosBuilt(opts: EnsureIosBuiltOptions): Promise<void> {
    const { cwd, logger, appName, target, bundleId, configuration = 'Debug', verbose = false } = opts;
    const iosDir = join(cwd, 'ios');

    logger.log('Running prebuild for iOS...');
    await runPrebuild({ android: false, ios: true, cwd });

    // Fast path: if the build-input fingerprint matches what we stored after
    // the last successful install AND the app is still on the target, skip
    // pod install / xcodebuild / install entirely. The dev-server's
    // auto-launch loop will (re)launch with the fresh dev URL.
    if (bundleId) {
        const fingerprint = fingerprintIosBuild(cwd, appName, configuration);
        const cacheKey = iosFingerprintKey(target, configuration);
        const cached = readCachedFingerprint(cwd, cacheKey);
        if (cached === fingerprint) {
            const installed = target.kind === 'simulator'
                ? isAppInstalledOnSimulator(target.udid, bundleId)
                : isAppInstalledOnDevice(target.udid, bundleId);
            if (installed) {
                logger.log(`\x1b[32m✓ ${target.name} up to date — skipping build\x1b[0m`);
                return;
            }
        }
    }

    await podInstallIfStale(iosDir, logger);

    logger.log(`Building iOS (${configuration}) for ${target.kind}...`);
    const workspace = join('ios', `${appName}.xcworkspace`);
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
    const appPath = findBuiltApp(appName, buildTarget, configuration);
    if (!appPath) {
        throw new Error(`Could not find built ${appName}.app in DerivedData (${buildTarget}, ${configuration})`);
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
        const fingerprint = fingerprintIosBuild(cwd, appName, configuration);
        writeCachedFingerprint(cwd, iosFingerprintKey(target, configuration), fingerprint);
    }
}
