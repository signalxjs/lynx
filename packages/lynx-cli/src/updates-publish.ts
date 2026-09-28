/**
 * `sigx updates:publish` — package a built `.lynx.bundle` as an OTA update for
 * `@sigx/lynx-updates`' static-manifest backend.
 *
 * This is the CLI wrapper: it resolves the app version / default channel from
 * `signalx.config.ts` (the heavy config loader stays here, off the publisher's
 * dependency-light path), delegates the actual packaging to
 * `@sigx/lynx-updates-publisher`'s `publishUpdate`, and prints a human summary.
 * CI should import `publishUpdate` directly instead of shelling out — it returns
 * structured metadata (`updateId`, `manifestPath`, `bundleUrl`, `sha256`, …).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { publishUpdate, type PublishUpdateResult } from '@sigx/lynx-updates-publisher';
import { loadConfig, findConfigPath } from './prebuild.js';
import { resolveConfig, type ResolvedConfig } from './config/parser.js';
import { envHash } from './config/env.js';
import { collectAsyncAssetsIn } from './util/embed-bundle.js';

export interface UpdatesPublishOptions {
    cwd: string;
    /** Bundle path. Default: dist/main.lynx.bundle. */
    bundle?: string;
    /** Output directory. Default: updates-dist. */
    out?: string;
    /** Release channel. Default: signalx.config updates.defaultChannel ?? 'production'. */
    channel?: string;
    /** Mark this update mandatory (blocking UI + forced install). */
    mandatory?: boolean;
    /** Override the runtime version for BOTH platforms (user-pinned scheme). */
    runtimeVersion?: string;
    /** Release notes attached as metadata. */
    notes?: string;
    /**
     * Publish even when dist/ contains async chunks from dynamic `import()`.
     * The OTA payload carries only `main.lynx.bundle`, so chunks referenced by
     * an updated bundle are unreachable on devices unless hosted remotely via
     * a custom assetPrefix (#599).
     */
    allowAsyncChunks?: boolean;
    /**
     * Build variant the bundle is published for (issue #1244). Resolves the
     * variant's config (its `updates.defaultChannel`, app env) and must match
     * the variant `dist/.sigx-build.json` says the bundle was built for.
     */
    variant?: string;
    /** Skip the `.sigx-build.json` variant / env check. */
    skipBuildCheck?: boolean;
    logger?: { log: (msg: string) => void; error: (msg: string) => void; warn?: (msg: string) => void };
}

/**
 * Build marker written next to the bundle by `@sigx/lynx-plugin` after
 * `rspeedy build` (issue #1244). Never embedded or published — it only lets
 * `updates:publish` check the bundle was built for the variant being
 * published.
 */
export interface BuildMarker {
    /** Variant the bundle was built for; `''` for the base build. */
    variant: string;
    /** sha256 of the canonical app-env JSON baked into the bundle. */
    envHash: string;
    /** OTA channel baked into the bundle, if any. */
    channel?: string;
    builtAt: string;
}

export const BUILD_MARKER_FILE = '.sigx-build.json';

function variantLabel(variant: string | undefined): string {
    return variant ? `variant '${variant}'` : 'the base (production) config';
}

/**
 * Check `<buildRoot>/.sigx-build.json` against the variant (and, when the
 * config is available, the app env) being published. Throws on a missing
 * marker or a variant mismatch; warns when the env differs from what the
 * config resolves to now.
 */
export function checkBuildMarker(
    buildRoot: string,
    variant: string | undefined,
    config: ResolvedConfig | undefined,
    warn: (msg: string) => void,
): BuildMarker {
    const markerPath = join(buildRoot, BUILD_MARKER_FILE);
    if (!existsSync(markerPath)) {
        throw new Error(
            `${markerPath} not found — can't verify which variant this bundle was built for. `
            + `Rebuild with \`sigx build${variant ? ` --variant ${variant}` : ''}\`, `
            + 'or pass --skip-build-check to publish anyway.',
        );
    }
    let marker: BuildMarker;
    try {
        marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as BuildMarker;
    } catch (err) {
        throw new Error(`${markerPath} is not valid JSON (${(err as Error).message}). Rebuild, or pass --skip-build-check.`);
    }
    const built = marker.variant ?? '';
    const wanted = variant ?? '';
    if (built !== wanted) {
        throw new Error(
            `${buildRoot} was built for ${variantLabel(built)}, but you're publishing for ${variantLabel(wanted)}. `
            + (built
                ? `Pass --variant ${built} to publish it as that variant, or rebuild with \`sigx build${wanted ? ` --variant ${wanted}` : ''}\`.`
                : `Rebuild with \`sigx build --variant ${wanted}\`, or drop --variant to publish the base build.`),
        );
    }
    if (config && marker.envHash !== envHash(config.env)) {
        warn(
            `The app env baked into this bundle differs from what signalx.config.ts resolves to now `
            + `(${variantLabel(wanted)}). If this job lacks the build's environment variables that's expected; `
            + 'otherwise rebuild before publishing.',
        );
    }
    return marker;
}

export async function runUpdatesPublish(opts: UpdatesPublishOptions): Promise<PublishUpdateResult> {
    const log: NonNullable<UpdatesPublishOptions['logger']> = opts.logger ?? { log: console.log, error: console.error };

    // Check next to the bundle being published, not a hard-coded `<cwd>/dist`:
    // with `--bundle` pointed at a CI artifact, the latter would both miss that
    // bundle's own chunks and trip over unrelated stale ones left in dist/.
    // Resolution mirrors publishUpdate's.
    const bundlePath = resolve(opts.cwd, opts.bundle ?? join('dist', 'main.lynx.bundle'));
    const buildRoot = dirname(bundlePath);
    const asyncAssets = collectAsyncAssetsIn(buildRoot);
    if (asyncAssets.length > 0 && !opts.allowAsyncChunks) {
        throw new Error(
            `${buildRoot} contains ${asyncAssets.length} async chunk(s) from dynamic import() `
            + '(static/js/async/), but OTA updates carry only main.lynx.bundle — '
            + 'devices receiving this update could not load those chunks. Convert the '
            + 'dynamic imports to static ones, or pass --allow-async-chunks if the chunks '
            + 'are hosted remotely via a custom output.assetPrefix.',
        );
    }

    // App identity + channel from signalx.config.ts (variant-merged, so a
    // variant's `updates.defaultChannel` applies) — defaults are fine when
    // publishing from CI artifacts with no config present. A config that
    // exists but fails to load/resolve is a real error.
    let config: ResolvedConfig | undefined;
    let appVersion: string | undefined;
    if (findConfigPath(opts.cwd)) {
        const raw = await loadConfig(opts.cwd, opts.variant);
        // The raw version, not the resolved one: an unset version keeps the
        // publisher's own default rather than resolveConfig's.
        appVersion = raw.version;
        config = resolveConfig(raw, opts.variant);
    } else if (opts.variant) {
        throw new Error(`--variant ${opts.variant} needs a signalx.config.ts in ${opts.cwd}.`);
    }

    // Guard against publishing a bundle built for another variant (e.g. a
    // staging build to the production channel). Skipped when there's no
    // bundle — publishUpdate reports that with its own error.
    let marker: BuildMarker | undefined;
    if (!opts.skipBuildCheck && existsSync(bundlePath)) {
        const warn = log.warn ?? ((m: string) => log.log(`\x1b[33m⚠\x1b[0m ${m}`));
        marker = checkBuildMarker(buildRoot, opts.variant, config, warn);
    }

    const channel = opts.channel ?? config?.updates?.defaultChannel ?? marker?.channel;

    const result = await publishUpdate({
        cwd: opts.cwd,
        bundle: opts.bundle,
        out: opts.out,
        channel,
        appVersion,
        mandatory: opts.mandatory,
        runtimeVersion: opts.runtimeVersion,
        notes: opts.notes,
    });

    // Summary.
    log.log('');
    log.log('  \x1b[1m⬆ sigx updates:publish\x1b[0m');
    log.log('');
    log.log(`  Update id:   ${result.updateId}`);
    log.log(`  App version: ${result.appVersion}`);
    log.log(`  Channel:     ${result.channel}`);
    log.log(`  Bundle:      ${result.bundleUrl} (${(result.sizeBytes / 1024).toFixed(1)} KB)`);
    log.log(`  SHA-256:     ${result.sha256}`);
    for (const { platform, runtimeVersion } of result.runtimeVersions) {
        log.log(`  Runtime:     ${platform} ${runtimeVersion}`);
    }
    if (result.mandatory) log.log('  Mandatory:   yes');
    log.log('');
    log.log(`  Output: ${dirname(result.manifestPath)}`);
    log.log('  Upload the directory to your static host; point Updates.configure() at');
    log.log(`  <host>/${result.channel}/manifest.json. Clients on a DIFFERENT runtime version`);
    log.log('  (older/newer native binary) will skip this update by design.');
    log.log('');

    return result;
}
