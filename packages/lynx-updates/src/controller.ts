/**
 * The updates state machine + mode orchestration. Modes are a thin strategy
 * layer over the same primitives the public API exposes:
 *
 *   silent    → check + download on launch/foreground; stop at 'ready'
 *   immediate → silent, then apply() as soon as 'ready'
 *   manual    → nothing automatic
 *
 * Mandatory updates (manifest.mandatory && honorMandatory) override every
 * mode: state.mandatory blocks the UI, the download is forced (even in
 * manual) and the update auto-applies once ready — the user is blocked
 * anyway, so restarting immediately strictly beats staying blocked.
 */

import { createLogger } from '@sigx/lynx-core';
import { addNativeUpdatesListener } from './events.js';
import {
    bakedChannel,
    getCurrentUpdate,
    getInstalledRuntimeVersion,
    getPlatform,
    nativeApplyNow,
    nativeApplyOnNextLaunch,
    nativeAvailable,
    nativeClearUpdates,
    nativeDownload,
    nativeMarkReady,
    nativeSetRollbackOptions,
} from './native.js';
import { StaticManifestProvider } from './provider/static-manifest.js';
import { emit, store } from './state.js';
import {
    UpdatesError,
    type DownloadSpec,
    type UpdateCheckContext,
    type UpdateCheckResult,
    type UpdateManifest,
    type UpdateProvider,
    type UpdatesConfig,
} from './types.js';

const log = createLogger('updates');

interface ResolvedUpdatesConfig {
    provider: UpdateProvider;
    channel: string;
    mode: 'silent' | 'immediate' | 'manual';
    checkOn: Array<'launch' | 'foreground'>;
    honorMandatory: boolean;
    autoMarkReady: boolean;
}

let config: ResolvedUpdatesConfig | null = null;
let unsubscribeNative: (() => void) | null = null;
let warnedUnavailable = false;
let checkInFlight: Promise<UpdateCheckResult> | null = null;
let downloadInFlight: Promise<void> | null = null;

function requireConfig(): ResolvedUpdatesConfig {
    if (!config) {
        throw new UpdatesError('not-configured', 'Call Updates.configure() before using the Updates API');
    }
    return config;
}

function warnUnavailableOnce(): void {
    if (warnedUnavailable) return;
    warnedUnavailable = true;
    log.warn('Updates native module not available — OTA updates are a no-op in this environment');
}

/** @internal */
export function configure(raw: UpdatesConfig): void {
    const provider: UpdateProvider =
        'checkForUpdate' in raw.provider
            ? raw.provider
            : new StaticManifestProvider(raw.provider);

    config = {
        provider,
        channel: raw.channel ?? bakedChannel(),
        mode: raw.mode ?? 'silent',
        checkOn: raw.checkOn ?? ['launch'],
        honorMandatory: raw.honorMandatory !== false,
        autoMarkReady: raw.autoMarkReady !== false,
    };

    if (!nativeAvailable()) {
        warnUnavailableOnce();
        return;
    }

    // Native event channel: download progress + foreground re-checks.
    unsubscribeNative?.();
    unsubscribeNative = addNativeUpdatesListener((event) => {
        if (event.kind === 'progress') {
            const progress = { receivedBytes: event.receivedBytes, totalBytes: event.totalBytes };
            store.progress = progress;
            emit({ type: 'downloadProgress', progress });
            return;
        }
        if (event.kind === 'foreground' && config?.mode !== 'manual' && config?.checkOn.includes('foreground')) {
            void checkAndMaybeDownload();
        }
    });

    if (raw.rollback?.maxFailedLaunches !== undefined) {
        void nativeSetRollbackOptions(raw.rollback.maxFailedLaunches);
    }

    // Defer everything else off the boot path — never block first paint.
    setTimeout(() => {
        void bootstrap();
    }, 0);
}

async function bootstrap(): Promise<void> {
    const cfg = requireConfig();

    // Surface what we're running + rollback outcome from the resolver.
    try {
        const running = await getCurrentUpdate();
        store.currentlyRunning = running;
        if (running.didRollBack && running.updateId !== null) {
            emit({ type: 'rolledBack', fromUpdateId: running.updateId });
        } else if (running.didRollBack) {
            emit({ type: 'rolledBack', fromUpdateId: 'unknown' });
        }
    } catch (err) {
        log.warn('getCurrentUpdate failed:', err);
    }

    // Health signal — the pending update commits once JS is alive. Apps
    // that gate on their own readiness set autoMarkReady: false and call
    // Updates.markReady() themselves.
    if (cfg.autoMarkReady) {
        try {
            await nativeMarkReady();
        } catch (err) {
            log.warn('markReady failed:', err);
        }
    }

    if (cfg.mode !== 'manual' && cfg.checkOn.includes('launch')) {
        await checkAndMaybeDownload();
    }
}

function buildContext(cfg: ResolvedUpdatesConfig): UpdateCheckContext {
    const running = store.currentlyRunning;
    return {
        platform: getPlatform(),
        runtimeVersion: getInstalledRuntimeVersion(),
        currentUpdateId: running.updateId,
        embeddedVersion: running.isEmbedded ? running.version : '',
        channel: cfg.channel,
    };
}

/** @internal */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
    const cfg = requireConfig();
    if (checkInFlight) return checkInFlight;

    checkInFlight = (async () => {
        store.status = 'checking';
        store.error = null;
        emit({ type: 'checkStarted' });
        try {
            const ctx = buildContext(cfg);
            let result = await cfg.provider.checkForUpdate(ctx);

            // Core re-validates the provider's answer: a manifest whose
            // runtimeVersion doesn't match this binary is never installable,
            // whatever the provider claims.
            if (result.type === 'update-available' &&
                result.manifest.runtimeVersion !== ctx.runtimeVersion) {
                result = { type: 'incompatible', manifest: result.manifest };
            }

            switch (result.type) {
                case 'up-to-date':
                    store.status = 'up-to-date';
                    store.manifest = null;
                    emit({ type: 'upToDate' });
                    break;
                case 'incompatible':
                    store.status = 'incompatible';
                    store.manifest = result.manifest;
                    emit({ type: 'incompatibleUpdate', manifest: result.manifest });
                    break;
                case 'update-available':
                    store.status = 'available';
                    store.manifest = result.manifest;
                    emit({ type: 'updateAvailable', manifest: result.manifest });
                    if (result.manifest.mandatory && cfg.honorMandatory) {
                        store.mandatory = true;
                        // Mandatory overrides every mode (including manual):
                        // the UI is blocked, so install immediately. Fire and
                        // forget — progress/errors surface via state/events.
                        void runMandatoryPipeline(result.manifest);
                    }
                    break;
            }
            return result;
        } catch (err) {
            const error = err instanceof UpdatesError
                ? err
                : new UpdatesError('check-failed', `${(err as Error)?.message ?? err}`);
            store.status = 'error';
            store.error = error;
            emit({ type: 'error', error });
            throw error;
        } finally {
            checkInFlight = null;
        }
    })();
    return checkInFlight;
}

/** @internal */
export async function download(manifest?: UpdateManifest): Promise<void> {
    const cfg = requireConfig();
    const target = manifest ?? store.manifest;
    if (!target) {
        throw new UpdatesError('download-failed', 'No update to download — call checkForUpdate() first');
    }
    if (downloadInFlight) return downloadInFlight;

    downloadInFlight = (async () => {
        const ctx = buildContext(cfg);
        if (target.runtimeVersion !== ctx.runtimeVersion) {
            throw new UpdatesError(
                'runtime-mismatch',
                `Update ${target.id} requires runtime ${target.runtimeVersion}; this binary is ${ctx.runtimeVersion} — a store release is needed`,
            );
        }
        store.status = 'downloading';
        store.manifest = target;
        store.progress = { receivedBytes: 0, totalBytes: null };
        store.error = null;
        emit({ type: 'downloadStarted', manifest: target });
        try {
            const spec: DownloadSpec = cfg.provider.resolveDownload
                ? await cfg.provider.resolveDownload(target, ctx)
                : { url: target.bundleUrl, sha256: target.sha256 };
            await nativeDownload(spec, target.id, target.runtimeVersion, JSON.stringify(target));
            // Default activation policy: the staged bundle loads on the next
            // cold launch. apply() upgrades that to an immediate reload.
            await nativeApplyOnNextLaunch(target.id);
            store.status = 'ready';
            store.progress = null;
            emit({ type: 'updateReady', manifest: target });
        } catch (err) {
            const error = err instanceof UpdatesError
                ? err
                : new UpdatesError('download-failed', `${(err as Error)?.message ?? err}`);
            store.status = 'error';
            store.progress = null;
            store.error = error;
            emit({ type: 'error', error });
            throw error;
        } finally {
            downloadInFlight = null;
        }
    })();
    return downloadInFlight;
}

/** @internal */
export async function apply(): Promise<void> {
    requireConfig();
    const target = store.manifest;
    if (!target || store.status !== 'ready') {
        throw new UpdatesError('apply-failed', 'No downloaded update to apply — download() must complete first');
    }
    store.status = 'applying';
    emit({ type: 'applying' });
    try {
        // On success the JS context is replaced — this only returns on failure.
        await nativeApplyNow(target.id);
    } catch (err) {
        const error = err instanceof UpdatesError
            ? err
            : new UpdatesError('apply-failed', `${(err as Error)?.message ?? err}`);
        // The bundle stays staged for next launch, so 'ready' remains true.
        store.status = 'ready';
        store.error = error;
        emit({ type: 'error', error });
        throw error;
    }
}

/** Forced install for mandatory updates — runs in every mode. */
async function runMandatoryPipeline(target: UpdateManifest): Promise<void> {
    try {
        await download(target);
        await apply();
    } catch {
        // surfaced via state/events; UpdateGate offers retry
    }
}

/** Check, then (per mode policy) download and maybe apply. @internal */
export async function checkAndMaybeDownload(): Promise<void> {
    const cfg = requireConfig();
    let result: UpdateCheckResult;
    try {
        result = await checkForUpdate();
    } catch {
        return; // surfaced via state/events already
    }
    if (result.type !== 'update-available') return;
    // Mandatory updates were already dispatched inside checkForUpdate.
    if (result.manifest.mandatory && cfg.honorMandatory) return;
    if (cfg.mode === 'manual') return;

    try {
        await download(result.manifest);
    } catch {
        return;
    }
    if (cfg.mode === 'immediate') {
        try {
            await apply();
        } catch {
            // surfaced via state/events; staged for next launch regardless
        }
    }
}

/** @internal */
export async function markReady(): Promise<void> {
    await nativeMarkReady();
}

/** @internal */
export async function clearUpdates(): Promise<void> {
    await nativeClearUpdates();
}

/** Test-only: reset module-level config. @internal */
export function __resetForTests(): void {
    config = null;
    unsubscribeNative?.();
    unsubscribeNative = null;
    warnedUnavailable = false;
    checkInFlight = null;
    downloadInFlight = null;
}
