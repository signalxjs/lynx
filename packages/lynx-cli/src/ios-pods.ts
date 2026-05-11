/**
 * CocoaPods helpers.
 *
 * Decides whether `pod install` needs to run and surfaces actionable errors
 * when the `pod` CLI isn't available.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';

/**
 * Is the `pod` CLI available on PATH?
 */
export function isPodAvailable(): boolean {
    try {
        execSync('pod --version', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Decide whether `pod install` should run for the given iOS project directory.
 *
 * Triggers:
 *  - Podfile.lock missing
 *  - Podfile mtime > Podfile.lock mtime (which `runPrebuild` causes when the
 *    set of linked pods changes — the Podfile is rewritten)
 */
export function podsAreStale(iosDir: string): boolean {
    const podfile = join(iosDir, 'Podfile');
    const lock = join(iosDir, 'Podfile.lock');

    if (!existsSync(podfile)) return false; // no iOS project yet
    if (!existsSync(lock)) return true;

    try {
        const podfileMtime = statSync(podfile).mtimeMs;
        const lockMtime = statSync(lock).mtimeMs;
        return podfileMtime > lockMtime;
    } catch {
        return true; // stat failure — be safe and reinstall
    }
}

/**
 * Run `pod install` in the given iOS directory. Emits a clear, actionable
 * error if `pod` isn't on PATH or the install fails.
 */
export async function podInstall(iosDir: string, logger: Logger): Promise<void> {
    if (!isPodAvailable()) {
        logger.error('The `pod` command was not found on PATH.');
        logger.error('Install it with: sudo gem install cocoapods');
        logger.error('Or via Homebrew:  brew install cocoapods');
        throw new Error('cocoapods not installed');
    }

    logger.log('Installing CocoaPods dependencies (this can take a minute)...');
    const child = spawn('pod', ['install'], { cwd: iosDir, stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                logger.error('`pod install` failed.');
                logger.error('Try: cd ios && pod repo update && pod install');
                reject(new Error('pod install failed'));
            }
        });
    });
}

/**
 * Install pods if and only if they are stale. No-op otherwise.
 */
export async function podInstallIfStale(iosDir: string, logger: Logger): Promise<void> {
    if (podsAreStale(iosDir)) {
        await podInstall(iosDir, logger);
    }
}
