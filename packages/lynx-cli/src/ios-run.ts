/**
 * Shared iOS build + install orchestration.
 *
 * Used by both `sigx run:ios` and `sigx dev` (when the user picks an iOS
 * target). The caller is responsible for resolving and booting the target
 * — this helper only runs prebuild, pods, xcodebuild, and the install.
 * Launching is deliberately left to the dev server's auto-launch loop so
 * `sigx dev` can launch every picked target at once with the right URL.
 */

import { join } from 'node:path';
import type { Logger } from '@sigx/cli/plugin';
import { iosDirName } from './config/paths.js';
import { runPrebuild } from './prebuild.js';
import { podInstallIfStale } from './ios-pods.js';
import { runWithBuildFilter } from './build-output.js';
import {
    findBuiltApp,
    getInstalledAppContainer,
    installAppOnDevice,
    installAppOnSimulator,
    iosDerivedDataPath,
    isAppInstalledOnDevice,
} from './device-detect.js';
import {
    fingerprintIosBuild,
    readCachedFingerprint,
    writeCachedFingerprint,
} from './util/build-fingerprint.js';
import { sameAppBinary } from './util/app-identity.js';

export type IosBuildTarget =
    | { kind: 'simulator'; udid: string; name: string }
    | { kind: 'device'; udid: string; name: string };

export interface EnsureIosBuiltOptions {
    cwd: string;
    logger: Logger;
    appName: string;
    target: IosBuildTarget;
    /**
     * App bundle identifier. When provided, enables the "already up to date"
     * fast path — we check whether the app is still installed on `target` and
     * skip xcodebuild + install when the build-input fingerprint matches the
     * last successful install.
     */
    bundleId?: string;
    configuration?: 'Debug' | 'Release';
    verbose?: boolean;
    /** Build variant (#530) — selects the `ios-<variant>/` output dir. */
    variant?: string;
}

function iosFingerprintKey(target: IosBuildTarget, configuration: string, variant?: string): string {
    return `ios-${variant ? `${variant}-` : ''}${configuration.toLowerCase()}-${target.kind}-${target.udid}`;
}

/**
 * The xcodebuild argument list for an app build.
 *
 * Shared because `run:ios` and `sigx dev` each drive their own xcodebuild and
 * had drifted: only one of them carried the derived-data path comment, and a
 * fix to either could miss the other. Pure, so the flags are testable without
 * spawning anything.
 */
export function iosBuildArgs(opts: {
    workspace: string;
    scheme: string;
    destinationId: string;
    configuration: string;
    derivedDataPath: string;
    /** Physical devices are signed; simulators are not. */
    isDevice: boolean;
}): string[] {
    return [
        '-workspace', opts.workspace,
        '-scheme', opts.scheme,
        '-destination', `id=${opts.destinationId}`,
        '-configuration', opts.configuration,
        // Project-local products dir — two checkouts sharing a scheme name
        // must never resolve each other's .app (#178).
        '-derivedDataPath', opts.derivedDataPath,
        // Automatic signing refuses to create or refresh a provisioning
        // profile without this, so a first build to a new device fails with
        // "No profiles for '<bundle id>' were found" even with the team set
        // correctly (#1032). Device only: a simulator build isn't signed, and
        // passing it there invites pointless round-trips to Apple.
        ...(opts.isDevice ? ['-allowProvisioningUpdates'] : []),
        'build',
    ];
}

/**
 * Watch xcodebuild's output for the device failures worth naming, and pick the
 * most specific explanation the output supports.
 *
 * The build runner rejects with a bare "exited with code N", so the reason has
 * to be caught as it streams past. Every case here was hit on a connected iPad
 * and none is about signing, which is all the old blanket message said
 * (#1032). Shared because `run:ios` and `sigx dev` each drive their own
 * xcodebuild.
 */
export function createIosDeviceTroubleWatcher() {
    let notReady = false;
    let noDestination = false;
    let unregisterableBundleId = false;
    // Chunk boundaries are arbitrary — `runWithBuildFilter` says so, and its
    // own sink buffers for the same reason. A phrase split across two chunks
    // ("destination spec" + "ifier") would match neither, and the build would
    // fall back to the generic signing message for a failure we can name. Carry
    // the tail of each chunk into the next; 256 chars is many times the longest
    // phrase, and bounded so a long build can't grow it.
    const CARRY = 256;
    let carry = '';
    return {
        onChunk(chunk: Buffer): void {
            const text = carry + chunk.toString();
            carry = text.slice(-CARRY);
            if (/Device is busy|Waiting to reconnect/i.test(text)) notReady = true;
            if (/destination specifier/i.test(text)) noDestination = true;
            // "…cannot be registered to your development team because it is not
            // available" / "Failed Registering Bundle Identifier" — device-seen
            // with the scaffold's `com.example.<app>` placeholder.
            if (/Registering Bundle Identifier|cannot be registered to your development team/i.test(text)) {
                unregisterableBundleId = true;
            }
        },
        /** The most specific explanation the output supports. */
        message(target: { name: string; udid: string }): string {
            if (notReady) {
                return `Device build failed: ${target.name} is connected but not ready. Unlock it `
                    + 'and leave it awake — Xcode mounts the developer disk image on first use '
                    + 'after enabling Developer Mode or an OS update, and `xcrun devicectl list '
                    + 'devices` reports "connected (no DDI)" until it has.';
            }
            if (noDestination) {
                return `Device build failed: xcodebuild could not match ${target.name} `
                    + `(id=${target.udid}). Check \`xcrun xctrace list devices\` — the id must be `
                    + "the hardware UDID, not devicectl's CoreDevice identifier.";
            }
            if (unregisterableBundleId) {
                return 'Device build failed: the bundle identifier is not available to your team. '
                    + 'App IDs are globally unique across Apple, so a shared example app cannot '
                    + 'ship one that works for everyone — set SIGX_IOS_BUNDLE_ID to something of '
                    + 'your own (e.g. com.you.app).';
            }
            return 'Device build failed. Check that a development team is selected in Xcode '
                + '(Signing & Capabilities), or set SIGX_IOS_DEVELOPMENT_TEAM. If the identifier '
                + 'is the problem rather than the team, set SIGX_IOS_BUNDLE_ID.';
        },
    };
}

export async function ensureIosBuilt(opts: EnsureIosBuiltOptions): Promise<void> {
    const { cwd, logger, appName, target, bundleId, configuration = 'Debug', verbose = false, variant } = opts;
    const iosDirRel = iosDirName(variant);
    const iosDir = join(cwd, iosDirRel);

    logger.log('Running prebuild for iOS...');
    await runPrebuild({ android: false, ios: true, cwd, variant });

    // Fast path: if the build-input fingerprint matches what we stored after
    // the last successful install AND the app on the target is provably OURS,
    // skip pod install / xcodebuild / install entirely. The dev-server's
    // auto-launch loop will (re)launch with the fresh dev URL.
    if (bundleId) {
        const fingerprint = fingerprintIosBuild(cwd, appName, configuration, variant);
        const cacheKey = iosFingerprintKey(target, configuration, variant);
        const cached = readCachedFingerprint(cwd, cacheKey);
        if (cached === fingerprint) {
            let upToDate: boolean;
            if (target.kind === 'simulator') {
                // Identity-aware skip (#178): a matching fingerprint only
                // proves THIS checkout's inputs haven't changed — another
                // checkout of the same app (same bundle id) may have installed
                // ITS binary over ours since. The simulator's app container is
                // a plain host directory, so compare the installed executable
                // against our local build products and skip only when they're
                // byte-identical.
                const installedApp = getInstalledAppContainer(target.udid, bundleId);
                const localApp = findBuiltApp(cwd, appName, 'simulator', configuration, variant);
                upToDate = installedApp !== null && localApp !== null
                    && sameAppBinary(installedApp, localApp);
            } else {
                // Physical devices: the installed bundle isn't host-readable
                // via devicectl, so the identity check isn't possible — keep
                // the is-installed probe. A cross-checkout overwrite on a
                // device can still defeat this (documented limitation, #178).
                upToDate = isAppInstalledOnDevice(target.udid, bundleId);
            }
            if (upToDate) {
                logger.log(`\x1b[32m✓ ${target.name} up to date — skipping build\x1b[0m`);
                return;
            }
        }
    }

    await podInstallIfStale(iosDir, logger);

    logger.log(`Building iOS (${configuration}) for ${target.kind}...`);
    const workspace = join(iosDirRel, `${appName}.xcworkspace`);
    const trouble = createIosDeviceTroubleWatcher();
    try {
        await runWithBuildFilter(
            'xcodebuild',
            iosBuildArgs({
                workspace,
                scheme: appName,
                destinationId: target.udid,
                configuration,
                derivedDataPath: iosDerivedDataPath(cwd, variant),
                isDevice: target.kind === 'device',
            }),
            { cwd },
            { kind: 'xcodebuild', verbose, logger, onChunk: trouble.onChunk },
        );
    } catch {
        if (target.kind === 'device') {
            logger.error(trouble.message(target));
        }
        throw new Error(`iOS ${configuration} build failed`);
    }

    logger.log('\x1b[32m✓ App built\x1b[0m');

    const buildTarget = target.kind === 'device' ? 'device' : 'simulator';
    const appPath = findBuiltApp(cwd, appName, buildTarget, configuration, variant);
    if (!appPath) {
        throw new Error(`Could not find built ${appName}.app in ${iosDirRel}/build (${buildTarget}, ${configuration})`);
    }

    logger.log(`Installing on ${target.kind} (${target.name})...`);
    const installed = target.kind === 'device'
        ? installAppOnDevice(target.udid, appPath)
        : installAppOnSimulator(target.udid, appPath);
    if (!installed) {
        if (target.kind === 'device') {
            logger.error('Ensure the device is unlocked, trusted, and Developer Mode is enabled.');
        }
        throw new Error(`Failed to install app on ${target.kind}`);
    }
    logger.log('\x1b[32m✓ App installed\x1b[0m');

    // Record what we just installed so the next run can short-circuit when
    // nothing changed. Fingerprint is computed AFTER prebuild + xcodebuild,
    // which is fine — prebuild's outputs are deterministic for a given
    // config, and xcodebuild itself doesn't modify input sources.
    if (bundleId) {
        const fingerprint = fingerprintIosBuild(cwd, appName, configuration, variant);
        writeCachedFingerprint(cwd, iosFingerprintKey(target, configuration, variant), fingerprint);
    }
}
