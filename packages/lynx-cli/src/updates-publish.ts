/**
 * `sigx updates:publish` — package a built `.lynx.bundle` as an OTA update
 * for `@sigx/lynx-updates`' static-manifest backend.
 *
 * Output layout (drop the directory onto any static host/CDN unchanged —
 * `bundleUrl` is relative and the client resolves it against the manifest URL):
 *
 *   <out>/<channel>/
 *     manifest.json                          ← the moving pointer
 *     updates/<updateId>/main.lynx.bundle    ← content-addressed, accumulates
 *
 * `manifest.json` is the array-of-entries document `StaticManifestProvider`
 * consumes; publishing appends one entry per platform (fingerprints differ
 * per platform). Old binaries keep matching their old runtimeVersion entries
 * while new binaries pick up the new ones — that's the whole compatibility
 * story for "new package X requires a new prebuild".
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from './prebuild.js';
import { readRuntimeVersionsSidecar } from './util/runtime-version.js';

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
    logger?: { log: (msg: string) => void; error: (msg: string) => void };
}

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

export async function runUpdatesPublish(opts: UpdatesPublishOptions): Promise<void> {
    const log = opts.logger ?? { log: console.log, error: console.error };
    const cwd = opts.cwd;

    // 1. The bundle.
    const bundlePath = resolve(cwd, opts.bundle ?? join('dist', 'main.lynx.bundle'));
    if (!existsSync(bundlePath)) {
        throw new Error(
            `Bundle not found: ${bundlePath}\n` +
            `Run \`sigx build\` first (or pass --bundle <path>).`,
        );
    }
    const bundleBytes = readFileSync(bundlePath);
    if (bundleBytes.length === 0) {
        throw new Error(`Bundle is empty: ${bundlePath} — run \`sigx build\` first.`);
    }
    const sha256 = createHash('sha256').update(bundleBytes).digest('hex');
    const updateId = sha256.slice(0, 16);

    // 2. Runtime versions — from the prebuild sidecar, unless pinned.
    const runtimeVersions: Array<{ platform: 'android' | 'ios'; runtimeVersion: string }> = [];
    if (opts.runtimeVersion) {
        runtimeVersions.push(
            { platform: 'android', runtimeVersion: opts.runtimeVersion },
            { platform: 'ios', runtimeVersion: opts.runtimeVersion },
        );
    } else {
        const sidecar = readRuntimeVersionsSidecar(cwd);
        if (sidecar?.android) runtimeVersions.push({ platform: 'android', runtimeVersion: sidecar.android });
        if (sidecar?.ios) runtimeVersions.push({ platform: 'ios', runtimeVersion: sidecar.ios });
        if (runtimeVersions.length === 0) {
            throw new Error(
                'No runtime-version fingerprint found (.sigx/runtime-versions.json).\n' +
                'Run `sigx prebuild` first, or pass --runtime-version when managing compatibility manually.',
            );
        }
    }

    // 3. App identity + channel.
    let appVersion = '0.0.0';
    let channel = opts.channel;
    try {
        const config = await loadConfig(cwd);
        appVersion = config.version ?? appVersion;
        channel = channel ?? config.updates?.defaultChannel;
    } catch {
        // No config (publishing from CI artifacts) — defaults are fine.
    }
    channel = channel ?? 'production';

    // 4. Write the static-hosting layout.
    const outDir = resolve(cwd, opts.out ?? 'updates-dist');
    const channelDir = join(outDir, channel);
    const bundleRel = `updates/${updateId}/main.lynx.bundle`;
    const bundleDest = join(channelDir, 'updates', updateId, 'main.lynx.bundle');
    mkdirSync(dirname(bundleDest), { recursive: true });
    copyFileSync(bundlePath, bundleDest);

    const manifestPath = join(channelDir, 'manifest.json');
    const doc = readManifest(manifestPath);
    const createdAt = new Date().toISOString();
    for (const { platform, runtimeVersion } of runtimeVersions) {
        // Replace any prior entry for the same (platform, runtimeVersion) —
        // the manifest is the moving pointer; old bundles stay on disk.
        doc.updates = doc.updates.filter((e) =>
            !(e.platforms.length === 1 && e.platforms[0] === platform && e.runtimeVersion === runtimeVersion),
        );
        doc.updates.push({
            id: updateId,
            version: appVersion,
            channel,
            platforms: [platform],
            runtimeVersion,
            bundleUrl: bundleRel,
            sha256,
            mandatory: opts.mandatory === true,
            createdAt,
            ...(opts.notes ? { metadata: { releaseNotes: opts.notes } } : {}),
        });
    }
    writeFileSync(manifestPath, JSON.stringify(doc, null, 4) + '\n');

    // 5. Summary.
    log.log('');
    log.log('  \x1b[1m⬆ sigx updates:publish\x1b[0m');
    log.log('');
    log.log(`  Update id:   ${updateId}`);
    log.log(`  App version: ${appVersion}`);
    log.log(`  Channel:     ${channel}`);
    log.log(`  Bundle:      ${bundleRel} (${(bundleBytes.length / 1024).toFixed(1)} KB)`);
    log.log(`  SHA-256:     ${sha256}`);
    for (const { platform, runtimeVersion } of runtimeVersions) {
        log.log(`  Runtime:     ${platform} ${runtimeVersion}`);
    }
    if (opts.mandatory) log.log('  Mandatory:   yes');
    log.log('');
    log.log(`  Output: ${channelDir}`);
    log.log('  Upload the directory to your static host; point Updates.configure() at');
    log.log(`  <host>/${channel}/manifest.json. Clients on a DIFFERENT runtime version`);
    log.log('  (older/newer native binary) will skip this update by design.');
    log.log('');
}

function readManifest(path: string): ManifestDocument {
    if (existsSync(path)) {
        try {
            const doc = JSON.parse(readFileSync(path, 'utf-8'));
            if (doc?.schemaVersion === 1 && Array.isArray(doc.updates)) {
                return doc as ManifestDocument;
            }
        } catch {
            // fall through to fresh document
        }
    }
    return { schemaVersion: 1, updates: [] };
}
