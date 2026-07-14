/**
 * Embed the built `dist/main.lynx.bundle` — plus any async chunks emitted by
 * dynamic `import()` (#599) — into a generated native project so Release
 * archives carry the real bundle.
 *
 * `prebuild` seeds a 0-byte iOS placeholder (and nothing on Android) so dev /
 * sandbox builds fall through to the dev server / DevHomeScreen — the native
 * loaders treat a non-empty `main.lynx.bundle` as "load this" regardless of
 * build configuration. The real bundle is therefore copied in only on explicit
 * release intent: `run:ios --release` / `run:android --release`, and
 * `prebuild --embed-bundle` for external pipelines (fastlane, plain
 * `xcodebuild archive`, `gradle bundleRelease`, Xcode Cloud, …). See #521.
 */

import { join, relative, sep } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { copyFileIfChanged } from './idempotent-write.js';
import { iosSourceRoot, iosXcodeProjPath, androidAppDir } from '../config/paths.js';
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

    embedAsyncAssets(opts);
    return changed;
}

/**
 * Async chunks emitted by dynamic `import()` land under this dist subtree
 * (rsbuild's default `distPath.js` + rspack's async chunk folder). The same
 * relative path is preserved on the native side so the runtime's root-relative
 * request URL (`/static/js/async/<hash>.js`) maps 1:1 to an embedded asset.
 */
const ASYNC_ASSETS_SUBTREE = join('static', 'js', 'async');

export interface AsyncAsset {
    /** Path relative to dist/, posix separators (mirrors the request URL). */
    rel: string;
    abs: string;
    size: number;
}

/** Discover async chunks in `dist/` that a standalone build must carry. */
export function collectAsyncAssets(cwd: string): AsyncAsset[] {
    const root = join(cwd, 'dist', ASYNC_ASSETS_SUBTREE);
    if (!existsSync(root)) return [];
    const assets: AsyncAsset[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) walk(abs);
            else if (entry.isFile()) {
                assets.push({
                    rel: relative(join(cwd, 'dist'), abs).split(sep).join('/'),
                    abs,
                    size: statSync(abs).size,
                });
            }
        }
    };
    walk(root);
    return assets.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Directory the async-asset subtree is mirrored into per platform. */
export function asyncAssetsRoot(
    cwd: string,
    config: ResolvedConfig,
    platform: 'ios' | 'android',
): string {
    return platform === 'ios'
        ? join(iosSourceRoot(cwd, config), 'LynxAssets')
        : join(androidAppDir(cwd, config), 'src', 'main', 'assets');
}

/**
 * Mirror `dist/static/js/async/**` into the native project so the production
 * resource fetchers can serve dynamic-import chunks locally (#599). The stale
 * subtree is removed first — chunk hashes change every build, and leftovers
 * would ship dead code and grow the native project unboundedly.
 *
 * @returns number of embedded async assets.
 */
export function embedAsyncAssets(opts: EmbedBundleOptions): number {
    const { cwd, config, platform } = opts;
    const log = opts.log ?? ((msg: string) => console.log(`[sigx] ${msg}`));
    const label = platform === 'ios' ? 'iOS' : 'Android';

    const assets = collectAsyncAssets(cwd);
    const root = asyncAssetsRoot(cwd, config, platform);
    rmSync(join(root, ASYNC_ASSETS_SUBTREE), { recursive: true, force: true });
    if (assets.length === 0) return 0;

    if (platform === 'ios') {
        // The LynxAssets folder reference is injected into the pbxproj by
        // prebuild; without it Xcode silently ships none of the chunks.
        const pbxprojPath = join(iosXcodeProjPath(cwd, config), 'project.pbxproj');
        if (existsSync(pbxprojPath) && !readFileSync(pbxprojPath, 'utf-8').includes('LynxAssets')) {
            throw new Error(
                'The build emitted async chunks (dynamic import()), but the Xcode project '
                + 'has no LynxAssets folder reference — run `sigx prebuild` first to register it.',
            );
        }
    }

    for (const asset of assets) {
        const dest = join(root, ...asset.rel.split('/'));
        mkdirSync(join(dest, '..'), { recursive: true });
        copyFileIfChanged(asset.abs, dest);
    }
    const total = assets.reduce((sum, a) => sum + a.size, 0);
    const into = platform === 'ios' ? 'LynxAssets/' : 'assets/';
    log(`${label}: embedded ${assets.length} async chunk(s) into ${into} (${total} bytes)`);
    return assets.length;
}
