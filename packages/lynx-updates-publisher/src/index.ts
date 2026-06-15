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
    // Only accept non-empty strings — a malformed sidecar (or a non-string
    // passed via `runtimeVersions`) must not be stamped into the manifest,
    // where clients would later reject it.
    for (const platform of ['android', 'ios'] as const) {
        const value = source[platform];
        if (typeof value === 'string' && value.length > 0) {
            out.push({ platform, runtimeVersion: value });
        }
    }
    return out;
}

/**
 * An entry worth carrying forward when republishing. This MUST stay in sync
 * with `validateUpdatesManifest` in `@sigx/lynx-updates` (kept inline rather
 * than imported so the publisher stays dependency-light for CI): the client
 * rejects the WHOLE manifest if any single entry is invalid, so the rewritten
 * document must contain only entries that pass the client's rules.
 */
function isWellFormedEntry(e: unknown): e is ManifestEntry {
    if (!e || typeof e !== 'object') return false;
    const r = e as Record<string, unknown>;
    // Required non-empty strings.
    for (const field of ['version', 'runtimeVersion', 'bundleUrl', 'sha256'] as const) {
        if (typeof r[field] !== 'string' || (r[field] as string).length === 0) return false;
    }
    if (!/^[0-9a-f]{64}$/i.test(r.sha256 as string)) return false;
    // The publisher always writes a single-platform array; require a valid one
    // (the de-dupe filter below indexes `platforms`).
    if (!Array.isArray(r.platforms) || !r.platforms.every((p) => p === 'android' || p === 'ios')) {
        return false;
    }
    // Optional fields must still be well-typed when present.
    for (const field of ['channel', 'id', 'createdAt'] as const) {
        if (r[field] !== undefined && typeof r[field] !== 'string') return false;
    }
    if (r.mandatory !== undefined && typeof r.mandatory !== 'boolean') return false;
    return true;
}

/**
 * Normalize one existing entry, or drop it (null) when it's unrecoverably
 * malformed. A missing `platforms` is filled to both (the client's default for
 * an omitted value) rather than dropped — so migrating a manifest from another
 * tool/version never silently deletes valid historical entries.
 */
function normalizeEntry(e: unknown): ManifestEntry | null {
    const candidate = e && typeof e === 'object' && (e as Record<string, unknown>).platforms === undefined
        ? { ...(e as Record<string, unknown>), platforms: ['android', 'ios'] }
        : e;
    return isWellFormedEntry(candidate) ? candidate : null;
}

function readManifest(path: string): ManifestDocument {
    if (existsSync(path)) {
        try {
            const doc = JSON.parse(readFileSync(path, 'utf-8'));
            if (doc?.schemaVersion === 1 && Array.isArray(doc.updates)) {
                // Drop unrecoverably-malformed entries (and normalize fixable
                // ones) so each publish self-heals the manifest into a document
                // StaticManifestProvider will accept — it rejects the WHOLE
                // document if any single entry is invalid, so a stray bad entry
                // would otherwise break the channel permanently.
                const updates = doc.updates
                    .map(normalizeEntry)
                    .filter((e: ManifestEntry | null): e is ManifestEntry => e !== null);
                return { schemaVersion: 1, updates };
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

    // The channel is a name, not a path — it's used as a path segment AND served
    // as a URL segment, so reject separators and the `.`/`..` traversal segments
    // rather than writing outside the output directory. `.` is allowed *within*
    // a name (e.g. "2.0") but the bare `.`/`..` segments are not.
    if (!/^[A-Za-z0-9._-]+$/.test(channel) || channel === '.' || channel === '..') {
        throw new Error(
            `Invalid channel "${channel}": use only letters, digits, '.', '_' or '-' ` +
            `(not '.'/'..'); it is used as a directory and URL segment.`,
        );
    }

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
        // manifest is the moving pointer; old bundles stay on disk. Entries are
        // already sanitized by readManifest(), so `platforms` is always an array.
        doc.updates = doc.updates.filter((e) =>
            !(e.platforms.length === 1 && e.platforms[0] === platform && e.runtimeVersion === runtimeVersion),
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
