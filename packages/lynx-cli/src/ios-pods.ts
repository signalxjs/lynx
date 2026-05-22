/**
 * CocoaPods helpers.
 *
 * Decides whether `pod install` needs to run and surfaces actionable errors
 * when the `pod` CLI isn't available.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
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
 * Where we cache the "pods are clean" sentinel hash. Lives under the project's
 * `node_modules/.cache/` (a few directories away from the source `Podfile` /
 * `Podfile.lock` in `ios/`) so it survives `pod install` but is cleared by
 * `pnpm install`. Safe to delete by hand to force a re-install.
 */
function podHashPath(iosDir: string): string {
    // `iosDir` is the project's ios/ directory; the cache lives in the
    // project root's node_modules/.cache alongside other tool caches.
    return join(iosDir, '..', 'node_modules', '.cache', '@sigx', 'lynx-cli', 'podfile.hash');
}

/**
 * Sentinel hash for "the pods we have installed match the Podfile + lockfile
 * on disk". Hashing BOTH files matters: a Podfile-only change captures
 * additions/post-install tweaks before the lock has caught up, and a
 * Podfile.lock-only change captures branch switches / merges where the
 * Podfile is identical but the resolved versions differ.
 */
function currentPodSentinel(iosDir: string): string {
    const h = createHash('sha256');
    h.update(readFileSync(join(iosDir, 'Podfile')));
    h.update('\0');
    const lock = join(iosDir, 'Podfile.lock');
    if (existsSync(lock)) {
        h.update(readFileSync(lock));
    } else {
        h.update('no-lock');
    }
    return h.digest('hex');
}

/**
 * Decide whether `pod install` should run for the given iOS project directory.
 *
 * Triggers:
 *  - Podfile.lock missing
 *  - Cached sentinel hash missing or different from a hash of the current
 *    Podfile + Podfile.lock contents
 *
 * Hash beats mtime here: prebuild rewrites the Podfile on every run (template
 * refresh + pod-entry injection), so mtime-based staleness fires every time
 * even when nothing actually changed. SHA of the resolved bytes is the
 * canonical way to detect real changes.
 */
export function podsAreStale(iosDir: string): boolean {
    const podfile = join(iosDir, 'Podfile');
    const lock = join(iosDir, 'Podfile.lock');

    if (!existsSync(podfile)) return false; // no iOS project yet
    if (!existsSync(lock)) return true;

    try {
        const currentHash = currentPodSentinel(iosDir);
        const cachedHash = (() => {
            try { return readFileSync(podHashPath(iosDir), 'utf-8').trim(); } catch { return null; }
        })();
        return cachedHash !== currentHash;
    } catch {
        return true; // read failure — be safe and reinstall
    }
}

/**
 * Record the current Podfile + Podfile.lock sentinel hash after a successful
 * `pod install`. Idempotent.
 */
function writePodHash(iosDir: string): void {
    const podfile = join(iosDir, 'Podfile');
    if (!existsSync(podfile)) return;
    try {
        const hash = currentPodSentinel(iosDir);
        const out = podHashPath(iosDir);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, hash);
    } catch {
        // Best-effort — a missing hash file just means we'll reinstall once
        // unnecessarily next time. Not worth failing the build over.
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
                writePodHash(iosDir);
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
