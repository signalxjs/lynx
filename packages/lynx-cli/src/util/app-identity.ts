/**
 * Identity comparison between two .app bundles (#178).
 *
 * Used by the `ensureIosBuilt` fast path to prove that the app currently
 * installed on a simulator IS this checkout's build, not a same-bundle-id
 * install from another checkout (worktree/clone) of the same project. The
 * per-checkout fingerprint cache can't see cross-checkout installs, so the
 * skip additionally requires the installed main executable to be
 * byte-identical to the local build products.
 *
 * Pure filesystem — both paths must be host-readable (simulator app
 * containers are plain directories under `~/Library/Developer/CoreSimulator`).
 */

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * sha-256 of the .app bundle's main executable, or null when unreadable.
 * `CFBundleExecutable` defaults to the product name, which equals the .app
 * bundle's basename for sigx-generated projects — so the binary lives at
 * `<App>.app/<App>`.
 *
 * Hashed in fixed-size chunks — app binaries can run to tens/hundreds of MB,
 * so a whole-file `readFileSync` would spike peak memory for no benefit.
 */
export function appExecutableHash(appPath: string): string | null {
    const executable = join(appPath, basename(appPath, '.app'));
    let fd: number;
    try {
        fd = openSync(executable, 'r');
    } catch {
        return null;
    }
    try {
        const hash = createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let bytesRead: number;
        while ((bytesRead = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
            hash.update(chunk.subarray(0, bytesRead));
        }
        return hash.digest('hex');
    } catch {
        return null;
    } finally {
        closeSync(fd);
    }
}

/**
 * True when both bundles exist and their main executables are byte-identical.
 * Missing/unreadable binaries compare as NOT matching — callers treat that as
 * "can't prove identity, rebuild".
 */
export function sameAppBinary(appPathA: string, appPathB: string): boolean {
    const hashA = appExecutableHash(appPathA);
    return hashA !== null && hashA === appExecutableHash(appPathB);
}
