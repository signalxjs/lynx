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
import { runPrebuild } from './prebuild';
import { podInstallIfStale } from './ios-pods';
import { runWithBuildFilter } from './build-output';
import {
    findBuiltApp,
    installAppOnDevice,
    installAppOnSimulator,
} from './device-detect';

export type IosBuildTarget =
    | { kind: 'simulator'; udid: string; name: string }
    | { kind: 'device'; udid: string; name: string };

export interface EnsureIosBuiltOptions {
    cwd: string;
    logger: Logger;
    appName: string;
    target: IosBuildTarget;
    configuration?: 'Debug' | 'Release';
    verbose?: boolean;
}

export async function ensureIosBuilt(opts: EnsureIosBuiltOptions): Promise<void> {
    const { cwd, logger, appName, target, configuration = 'Debug', verbose = false } = opts;
    const iosDir = join(cwd, 'ios');

    logger.log('Running prebuild for iOS...');
    await runPrebuild({ android: false, ios: true, cwd });

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
}
