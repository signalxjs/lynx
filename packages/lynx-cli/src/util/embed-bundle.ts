/**
 * Embed the built `dist/main.lynx.bundle` into a generated native project so
 * Release archives carry the real bundle.
 *
 * `prebuild` seeds a 0-byte iOS placeholder (and nothing on Android) so dev /
 * sandbox builds fall through to the dev server / DevHomeScreen — the native
 * loaders treat a non-empty `main.lynx.bundle` as "load this" regardless of
 * build configuration. The real bundle is therefore copied in only on explicit
 * release intent: `run:ios --release` / `run:android --release`, and
 * `prebuild --embed-bundle` for external pipelines (fastlane, plain
 * `xcodebuild archive`, `gradle bundleRelease`, Xcode Cloud, …). See #521.
 */

import { join } from 'node:path';
import { mkdirSync, statSync } from 'node:fs';
import { copyFileIfChanged } from './idempotent-write.js';
import { iosSourceRoot, androidAppDir } from '../config/paths.js';
import type { ResolvedConfig } from '../config/parser.js';

export interface EmbedBundleOptions {
    cwd: string;
    config: ResolvedConfig;
    platform: 'ios' | 'android';
    /** Progress sink; defaults to a `[sigx]`-prefixed console line. */
    log?: (msg: string) => void;
}

/** Absolute path the production native loader reads the baked bundle from. */
export function embeddedBundleDest(
    cwd: string,
    config: ResolvedConfig,
    platform: 'ios' | 'android',
): string {
    return platform === 'ios'
        ? join(iosSourceRoot(cwd, config), 'main.lynx.bundle')
        : join(androidAppDir(cwd, config), 'src', 'main', 'assets', 'main.lynx.bundle');
}

/**
 * Copy `dist/main.lynx.bundle` over the native project's bundle slot.
 *
 * Throws if the built bundle is missing or empty — the caller asked to embed,
 * so a silent no-op would bake the empty placeholder all over again.
 *
 * @returns `true` if the destination bytes changed, `false` if already current.
 */
export function embedBundle(opts: EmbedBundleOptions): boolean {
    const { cwd, config, platform } = opts;
    const log = opts.log ?? ((msg: string) => console.log(`[sigx] ${msg}`));

    const distBundle = join(cwd, 'dist', 'main.lynx.bundle');
    let size: number;
    try {
        size = statSync(distBundle).size;
    } catch {
        throw new Error(
            'Built bundle not found at dist/main.lynx.bundle — run `sigx build` first.',
        );
    }
    if (size === 0) {
        throw new Error(
            'Built bundle dist/main.lynx.bundle is empty — run `sigx build` first.',
        );
    }

    const dest = embeddedBundleDest(cwd, config, platform);
    mkdirSync(join(dest, '..'), { recursive: true });
    const changed = copyFileIfChanged(distBundle, dest);
    const label = platform === 'ios' ? 'iOS' : 'Android';
    log(changed
        ? `${label}: embedded dist/main.lynx.bundle (${size} bytes)`
        : `${label}: main.lynx.bundle already up to date (${size} bytes)`);
    return changed;
}
