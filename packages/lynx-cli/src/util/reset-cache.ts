/**
 * Build-cache reset for the `--reset-cache` flag.
 *
 * The fingerprints in `build-fingerprint.ts` / `prebuild.ts` are now keyed on
 * the lockfile, so a dependency version bump invalidates them automatically.
 * But rspack/rsbuild keep their OWN persistent cache (under `dist/`, `.rsbuild`,
 * and `node_modules/.cache`) that the fingerprints don't govern, so a stale
 * dependency can still slip into the JS bundle (#348). This wipes the caches the
 * version-keying can't reach, giving users a first-class escape hatch for a
 * guaranteed-clean rebuild.
 */

import { rmSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';

/**
 * `@sigx/lynx-cli` state files (under `node_modules/.cache/@sigx/lynx-cli/`)
 * that are NOT build caches and must survive `--reset-cache`: the dev-server
 * port lock — wiping it would re-enable the silent-second-server scenario the
 * lock prevents (#350) — and the target-selection history.
 */
const PRESERVE_SIGX_STATE = new Set(['dev-server.json', 'last-targets.json']);

/**
 * Remove the rsbuild/rspack output + persistent caches (`dist/`, `.rsbuild/`,
 * and the build entries under `node_modules/.cache`, including
 * `@sigx/lynx-cli`'s prebuild/native fingerprints) while preserving the
 * `@sigx/lynx-cli` state files. Best-effort per target — a missing path is fine
 * (worst case: one extra rebuild); a real failure (EPERM, locked file) is
 * surfaced with its message rather than reported as a clean wipe.
 */
export function resetBuildCaches(cwd: string, logger?: Logger): void {
    const failed: string[] = [];
    const tryRm = (p: string): void => {
        // maxRetries/retryDelay smooth over Windows' transient EPERM/EBUSY on
        // recently-touched files, keeping --reset-cache a reliable escape hatch.
        try { rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
        catch (err) { failed.push(`${p} (${(err as Error).message})`); }
    };
    const safeReaddir = (d: string): Dirent[] => {
        try {
            return readdirSync(d, { withFileTypes: true });
        } catch (err) {
            // A missing directory is expected (nothing to clear there); any
            // other failure (e.g. EPERM) is real and surfaced like an rm error.
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                failed.push(`${d} (${(err as Error).message})`);
            }
            return [];
        }
    };

    // rsbuild/rspack output + persistent caches at the project root.
    tryRm(join(cwd, 'dist'));      // includes dist/.rspeedy
    tryRm(join(cwd, '.rsbuild'));

    // node_modules/.cache holds rspack's filesystem cache AND @sigx/lynx-cli's
    // build fingerprints — both should go. But the same @sigx/lynx-cli dir also
    // holds STATE (the dev-server port lock, target history) that must survive,
    // so we descend and remove selectively there instead of wiping the tree.
    const cacheDir = join(cwd, 'node_modules', '.cache');
    for (const entry of safeReaddir(cacheDir)) {
        const entryPath = join(cacheDir, entry.name);
        if (entry.name !== '@sigx') { tryRm(entryPath); continue; }
        for (const pkg of safeReaddir(entryPath)) {
            const pkgPath = join(entryPath, pkg.name);
            if (pkg.name !== 'lynx-cli') { tryRm(pkgPath); continue; }
            for (const file of safeReaddir(pkgPath)) {
                if (!PRESERVE_SIGX_STATE.has(file.name)) tryRm(join(pkgPath, file.name));
            }
        }
    }

    if (failed.length > 0) {
        logger?.warn(`Could not clear ${failed.join('; ')} — delete manually if a stale build persists.`);
    } else {
        logger?.log('Cleared build caches (dist/, .rsbuild/, node_modules/.cache; kept the dev-server lock + target history).');
    }
}
