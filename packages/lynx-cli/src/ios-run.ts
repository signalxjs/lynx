/**
 * Shared iOS build + install orchestration.
 *
 * Used by both `sigx run:ios` and `sigx dev` (when the user picks an iOS
 * target). The caller is responsible for resolving and booting the target
 * — this helper only runs prebuild, pods, xcodebuild, and the install.
 * Launching is deliberately left to the dev server's auto-launch loop so
 * `sigx dev` can launch every picked target at once with the right URL.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import { runPrebuild } from './prebuild.js';
import { podInstallIfStale } from './ios-pods.js';
import {
    findBuiltApp,
    installAppOnDevice,
    installAppOnSimulator,
} from './device-detect.js';

export type IosBuildTarget =
    | { kind: 'simulator'; udid: string; name: string }
    | { kind: 'device'; udid: string; name: string };

export interface EnsureIosBuiltOptions {
    cwd: string;
    logger: Logger;
    appName: string;
    target: IosBuildTarget;
    configuration?: 'Debug' | 'Release';
}

export async function ensureIosBuilt(opts: EnsureIosBuiltOptions): Promise<void> {
    const { cwd, logger, appName, target, configuration = 'Debug' } = opts;
    const iosDir = join(cwd, 'ios');

    logger.log('Running prebuild for iOS...');
    await runPrebuild({ android: false, ios: true, cwd });

    await podInstallIfStale(iosDir, logger);

    logger.log(`Building iOS (${configuration}) for ${target.kind}...`);
    const workspace = join('ios', `${appName}.xcworkspace`);
    const build = spawn(
        'xcodebuild',
        [
            '-workspace', workspace,
            '-scheme', appName,
            '-destination', `id=${target.udid}`,
            '-configuration', configuration,
            'build',
        ],
        { cwd, stdio: 'inherit' },
    );

    await new Promise<void>((resolve, reject) => {
        build.on('exit', (code) => {
            if (code !== 0) {
                if (target.kind === 'device') {
                    logger.error('Device build failed. Check that a development team is selected in Xcode (Signing & Capabilities).');
                }
                reject(new Error(`iOS ${configuration} build failed`));
            } else {
                resolve();
            }
        });
    });

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
