/**
 * `@sigx/lynx-updates-publisher` — package a built `.lynx.bundle` into the
 * static-manifest layout `@sigx/lynx-updates`' `StaticManifestProvider`
 * consumes, and return structured metadata about the published update.
 *
 * This is the programmatic core of `sigx updates:publish`, factored out so CI
 * pipelines can publish a bundle **without shelling out and scraping stdout**.
 * It is intentionally dependency-light — only Node built-ins — so a release job
 * can `import { publishUpdate } from '@sigx/lynx-updates-publisher'` without
 * pulling the CLI's build toolchain.
 *
 * Output layout (drop the directory onto any static host/CDN unchanged —
 * `bundleUrl` is relative and the client resolves it against the manifest URL):
 *
 *   <out>/<channel>/
 *     manifest.json                          ← the moving pointer
 *     updates/<updateId>/main.lynx.bundle    ← content-addressed, accumulates
 *
 * Publishing appends/replaces one entry per platform (runtime-version
 * fingerprints differ per platform). Old binaries keep matching their old
 * `runtimeVersion` entries while new binaries pick up the new ones — that is
 * the whole compatibility story for "new native package X requires a prebuild".
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type PublishPlatform = 'android' | 'ios';

export interface PublishUpdateOptions {
    /** Project root. Used to resolve relative paths and the sidecar. */
    cwd: string;
    /** Bundle path (absolute, or relative to `cwd`). Default: `dist/main.lynx.bundle`. */
    bundle?: string;
    /** Output directory (absolute, or relative to `cwd`). Default: `updates-dist`. */
    out?: string;
    /** Release channel. Default: `'production'`. */
    channel?: string;
    /** Human-readable JS app version stamped on the entry. Default: `'0.0.0'`. */
    appVersion?: string;
    /** Mark this update mandatory (blocking UI + forced install). Default: false. */
    mandatory?: boolean;
    /** Release notes attached as `metadata.releaseNotes`. */
    notes?: string;
    /**
     * Override the runtime-version fingerprint for BOTH platforms (user-pinned
     * scheme). Takes precedence over `runtimeVersions` and the sidecar.
     */
    runtimeVersion?: string;
    /**
     * Explicit per-platform runtime-version fingerprints. Takes precedence over
     * the `.sigx/runtime-versions.json` sidecar. Provide this in CI when the
     * fingerprints are computed elsewhere.
     */
    runtimeVersions?: { android?: string; ios?: string };
}

export interface PublishUpdateResult {
    /** Content-addressed update id (`sha256.slice(0, 16)`). */
    updateId: string;
    /** Full hex SHA-256 of the bundle bytes (verified natively after download). */
    sha256: string;
    /** Relative bundle URL written into the manifest entries. */
    bundleUrl: string;
    /** Absolute path the bundle was read from. */
    bundlePath: string;
    /** Absolute path of the written `manifest.json`. */
    manifestPath: string;
    /** Resolved release channel. */
    channel: string;
    /** Resolved app version stamped on the entries. */
    appVersion: string;
    /** Bundle size in bytes. */
    sizeBytes: number;
    /** Whether the entries were marked mandatory. */
    mandatory: boolean;
    /** ISO-8601 timestamp stamped on the published entries. */
    createdAt: string;
    /** The (platform, runtimeVersion) entries written this publish. */
    runtimeVersions: Array<{ platform: PublishPlatform; runtimeVersion: string }>;
}

/** One published update, per (platform, runtimeVersion). */
interface ManifestEntry {
    id: string;
    version: string;
    channel: string;
    platforms: string[];
    runtimeVersion: string;
    bundleUrl: string;
    sha256: string;
    mandatory: boolean;
    createdAt: string;
    metadata?: Record<string, string>;
}

interface ManifestDocument {
    schemaVersion: 1;
    updates: ManifestEntry[];
}

/** Sidecar written by `sigx prebuild` (also read by `@sigx/lynx-plugin`). */
interface RuntimeVersionsSidecar {
    android?: string;
    ios?: string;
}

function readRuntimeVersionsSidecar(cwd: string): RuntimeVersionsSidecar | null {
    try {
        return JSON.parse(readFileSync(join(cwd, '.sigx', 'runtime-versions.json'), 'utf-8'));
    } catch {
        return null;
    }
}

function resolveRuntimeVersions(
    opts: PublishUpdateOptions,
): Array<{ platform: PublishPlatform; runtimeVersion: string }> {
    if (opts.runtimeVersion) {
        return [
            { platform: 'android', runtimeVersion: opts.runtimeVersion },
            { platform: 'ios', runtimeVersion: opts.runtimeVersion },
        ];
    }
    const source = opts.runtimeVersions ?? readRuntimeVersionsSidecar(opts.cwd) ?? {};
    const out: Array<{ platform: PublishPlatform; runtimeVersion: string }> = [];
    if (source.android) out.push({ platform: 'android', runtimeVersion: source.android });
    if (source.ios) out.push({ platform: 'ios', runtimeVersion: source.ios });
    return out;
}

function readManifest(path: string): ManifestDocument {
    if (existsSync(path)) {
        try {
            const doc = JSON.parse(readFileSync(path, 'utf-8'));
            if (doc?.schemaVersion === 1 && Array.isArray(doc.updates)) {
                return doc as ManifestDocument;
            }
        } catch {
            // fall through to a fresh document
        }
    }
    return { schemaVersion: 1, updates: [] };
}

/**
 * Publish a built bundle as an OTA update. Returns structured metadata about
 * the published update (no logging, no process side effects beyond the written
 * files) so CI can assert on `updateId` / `manifestPath` / `bundleUrl` /
 * `sha256` directly.
 *
 * @throws if the bundle is missing/empty, or no runtime-version fingerprint can
 * be resolved (no `--runtime-version`, no explicit `runtimeVersions`, and no
 * `.sigx/runtime-versions.json` sidecar).
 */
export async function publishUpdate(opts: PublishUpdateOptions): Promise<PublishUpdateResult> {
    const { cwd } = opts;

    // 1. The bundle.
    const bundlePath = resolve(cwd, opts.bundle ?? join('dist', 'main.lynx.bundle'));
    if (!existsSync(bundlePath)) {
        throw new Error(
            `Bundle not found: ${bundlePath}\n` +
            `Run \`sigx build\` first (or pass a bundle path).`,
        );
    }
    const bundleBytes = readFileSync(bundlePath);
    if (bundleBytes.length === 0) {
        throw new Error(`Bundle is empty: ${bundlePath} — run \`sigx build\` first.`);
    }
    const sha256 = createHash('sha256').update(bundleBytes).digest('hex');
    const updateId = sha256.slice(0, 16);

    // 2. Runtime versions — pinned, explicit, or from the prebuild sidecar.
    const runtimeVersions = resolveRuntimeVersions(opts);
    if (runtimeVersions.length === 0) {
        throw new Error(
            'No runtime-version fingerprint found (.sigx/runtime-versions.json).\n' +
            'Run `sigx prebuild` first, or pass runtimeVersion / runtimeVersions when managing compatibility manually.',
        );
    }

    // 3. Identity + channel (resolved by the caller; defaults are CI-friendly).
    const appVersion = opts.appVersion ?? '0.0.0';
    const channel = opts.channel ?? 'production';
    const mandatory = opts.mandatory === true;

    // 4. Write the static-hosting layout.
    const outDir = resolve(cwd, opts.out ?? 'updates-dist');
    const channelDir = join(outDir, channel);
    const bundleUrl = `updates/${updateId}/main.lynx.bundle`;
    const bundleDest = join(channelDir, 'updates', updateId, 'main.lynx.bundle');
    mkdirSync(dirname(bundleDest), { recursive: true });
    // Write the bytes we already read (single read), rather than re-reading.
    writeFileSync(bundleDest, bundleBytes);

    const manifestPath = join(channelDir, 'manifest.json');
    const doc = readManifest(manifestPath);
    const createdAt = new Date().toISOString();
    for (const { platform, runtimeVersion } of runtimeVersions) {
        // Replace any prior entry for the same (platform, runtimeVersion) — the
        // manifest is the moving pointer; old bundles stay on disk. Guard the
        // predicate so a hand-edited / partially-corrupted manifest (e.g. an
        // entry missing `platforms`) is skipped rather than throwing.
        doc.updates = doc.updates.filter((e) =>
            !(Array.isArray(e.platforms) && e.platforms.length === 1 &&
                e.platforms[0] === platform && e.runtimeVersion === runtimeVersion),
        );
        doc.updates.push({
            id: updateId,
            version: appVersion,
            channel,
            platforms: [platform],
            runtimeVersion,
            bundleUrl,
            sha256,
            mandatory,
            createdAt,
            ...(opts.notes ? { metadata: { releaseNotes: opts.notes } } : {}),
        });
    }
    writeFileSync(manifestPath, JSON.stringify(doc, null, 4) + '\n');

    return {
        updateId,
        sha256,
        bundleUrl,
        bundlePath,
        manifestPath,
        channel,
        appVersion,
        sizeBytes: bundleBytes.length,
        mandatory,
        createdAt,
        runtimeVersions,
    };
}
