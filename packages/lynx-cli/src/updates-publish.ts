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

import { dirname } from 'node:path';
import { publishUpdate, type PublishUpdateResult } from '@sigx/lynx-updates-publisher';
import { loadConfig } from './prebuild.js';

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

export async function runUpdatesPublish(opts: UpdatesPublishOptions): Promise<PublishUpdateResult> {
    const log = opts.logger ?? { log: console.log, error: console.error };

    // App identity + channel from signalx.config.ts — defaults are fine when
    // publishing from CI artifacts with no config present.
    let appVersion: string | undefined;
    let channel = opts.channel;
    try {
        const config = await loadConfig(opts.cwd);
        appVersion = config.version;
        channel = channel ?? config.updates?.defaultChannel;
    } catch {
        // No config (publishing from CI artifacts) — defaults are fine.
    }

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
