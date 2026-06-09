/**
 * Build-cache reset for the `--reset-cache` flag.
 *
 * The fingerprints in `build-fingerprint.ts` / `prebuild.ts` are now keyed on
 * the lockfile, so a dependency version bump invalidates them automatically.
 * But rspack/rsbuild keep their OWN persistent cache under `dist/` that the
 * fingerprints don't govern, so a stale dependency can still slip into the JS
 * bundle (#348). This wipes the caches the version-keying can't reach, giving
 * users a first-class escape hatch for a guaranteed-clean rebuild.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';

/**
 * Remove `dist/` (the rsbuild output + its `.rspeedy` persistent cache) and
 * `node_modules/.cache` (rspack's cache plus `@sigx/lynx-cli`'s prebuild and
 * native build fingerprints). Best-effort per target — a missing or unremovable
 * path is ignored, since the worst case is one extra rebuild.
 */
export function resetBuildCaches(cwd: string, logger?: Logger): void {
    // `dist/` contains `dist/.rspeedy`, so removing it covers both. With
    // `force: true`, a missing path is NOT an error — only a real failure
    // (e.g. EPERM, a locked file) throws, which we surface rather than
    // reporting a clean wipe that didn't happen.
    const targets = [
        join(cwd, 'dist'),
        join(cwd, 'node_modules', '.cache'),
    ];
    const failed: string[] = [];
    for (const target of targets) {
        try { rmSync(target, { recursive: true, force: true }); } catch { failed.push(target); }
    }
    if (failed.length > 0) {
        logger?.warn(`Could not clear ${failed.join(', ')} — delete manually if a stale build persists.`);
    } else {
        logger?.log('Cleared build caches (dist/, node_modules/.cache).');
    }
}
