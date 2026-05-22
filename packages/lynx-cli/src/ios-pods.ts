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
 * Path of the cached Podfile content hash. Sibling to `Podfile.lock` under
 * `node_modules/.cache/` so it survives `pod install` (which rewrites the
 * lock) but not `pnpm install` (which clears the cache). Safe to delete by
 * hand to force a re-install.
 */
function podHashPath(iosDir: string): string {
    // `iosDir` is the project's ios/ directory; the cache lives next to
    // other tool caches in the project root.
    return join(iosDir, '..', 'node_modules', '.cache', '@sigx', 'lynx-cli', 'podfile.hash');
}

function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

/**
 * Decide whether `pod install` should run for the given iOS project directory.
 *
 * Triggers:
 *  - Podfile.lock missing
 *  - Cached Podfile hash missing or different from current Podfile content
 *
 * Hash beats mtime here: prebuild rewrites the Podfile on every run (template
 * refresh + pod-entry injection), so mtime-based staleness fires every time
 * even when nothing actually changed. SHA of the resolved Podfile bytes is
 * the canonical way to detect real changes.
 */
export function podsAreStale(iosDir: string): boolean {
    const podfile = join(iosDir, 'Podfile');
    const lock = join(iosDir, 'Podfile.lock');

    if (!existsSync(podfile)) return false; // no iOS project yet
    if (!existsSync(lock)) return true;

    try {
        const currentHash = sha256(readFileSync(podfile));
        const cachedHash = (() => {
            try { return readFileSync(podHashPath(iosDir), 'utf-8').trim(); } catch { return null; }
        })();
        return cachedHash !== currentHash;
    } catch {
        return true; // read failure — be safe and reinstall
    }
}

/**
 * Record the current Podfile hash after a successful `pod install`. Idempotent.
 */
function writePodHash(iosDir: string): void {
    const podfile = join(iosDir, 'Podfile');
    if (!existsSync(podfile)) return;
    try {
        const hash = sha256(readFileSync(podfile));
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
