/**
 * JS side of the `Updates` native module — thin promise wrappers over the
 * callback-based bridge, plus the build-time defines baked by
 * `@sigx/lynx-plugin`.
 *
 * Every wrapper degrades gracefully when the module is absent (web preview,
 * tests, app built without the package): reads return inert defaults,
 * mutations reject with `native-unavailable`.
 */

import { callAsync, callSync, isModuleAvailable, Platform } from '@sigx/lynx-core';
import { UpdatesError, type CurrentUpdateInfo, type DownloadSpec } from './types.js';

const MODULE = 'Updates';

// Baked by @sigx/lynx-plugin; absent in non-plugin builds (tests).
declare const __SIGX_RUNTIME_VERSIONS__:
    | { android?: string; ios?: string }
    | null
    | undefined;
declare const __SIGX_UPDATES_CHANNEL__: string | undefined;

export function nativeAvailable(): boolean {
    return isModuleAvailable(MODULE);
}

/** Default channel baked at build time ('production' when unset). */
export function bakedChannel(): string {
    return typeof __SIGX_UPDATES_CHANNEL__ === 'string' ? __SIGX_UPDATES_CHANNEL__ : 'production';
}

/**
 * The installed binary's runtime fingerprint. Native (BuildConfig /
 * Info.plist) is authoritative; the build define is an informational
 * fallback for environments without the module (web preview).
 */
export function getInstalledRuntimeVersion(): string {
    if (nativeAvailable()) {
        const v = callSync<string | null>(MODULE, 'getInstalledRuntimeVersion');
        if (typeof v === 'string' && v.length > 0) return v;
    }
    if (typeof __SIGX_RUNTIME_VERSIONS__ === 'object' && __SIGX_RUNTIME_VERSIONS__) {
        return __SIGX_RUNTIME_VERSIONS__.android ?? __SIGX_RUNTIME_VERSIONS__.ios ?? 'unknown';
    }
    return 'unknown';
}

export function getPlatform(): 'android' | 'ios' {
    if (nativeAvailable()) {
        const p = callSync<string | null>(MODULE, 'getPlatform');
        if (p === 'android' || p === 'ios') return p;
    }
    // Native is authoritative; fall back to core's SystemInfo-based detection
    // (web preview / tests / module absent). 'web' maps to 'android' here.
    return Platform.OS === 'ios' ? 'ios' : 'android';
}

const EMBEDDED_INFO: CurrentUpdateInfo = {
    updateId: null,
    version: '',
    embeddedVersion: '',
    runtimeVersion: 'unknown',
    isEmbedded: true,
    isFirstLaunchAfterUpdate: false,
    didRollBack: false,
    rolledBackUpdateId: null,
};

interface NativeError {
    error?: string;
    code?: string;
}

/**
 * Normalize native-side codes (E_* prefixed) to the public
 * {@link UpdatesErrorCode} union so consumers never see an out-of-contract
 * code. Unknown codes collapse to the call site's fallback.
 */
function normalizeCode(raw: string | undefined, fallback: UpdatesError['code']): UpdatesError['code'] {
    switch (raw) {
        case 'E_DOWNLOAD_IN_PROGRESS': return 'download-in-progress';
        case 'E_RUNTIME_MISMATCH': return 'runtime-mismatch';
        case 'E_NO_VIEW': return 'no-view';
        case 'hash-mismatch': return 'hash-mismatch';
        case 'apply-failed': return 'apply-failed';
        default: return fallback;
    }
}

function throwIfNativeError(result: unknown, code: UpdatesError['code']): void {
    const err = result as NativeError | null;
    if (err && typeof err === 'object' && typeof err.error === 'string') {
        throw new UpdatesError(normalizeCode(err.code, code), err.error);
    }
}

export async function getCurrentUpdate(): Promise<CurrentUpdateInfo> {
    if (!nativeAvailable()) return EMBEDDED_INFO;
    const raw = await callAsync<Partial<CurrentUpdateInfo> | null>(MODULE, 'getCurrentUpdate');
    // Reads surface native failures too — callAsync resolves error maps.
    throwIfNativeError(raw, 'native-error');
    if (!raw || typeof raw !== 'object') return EMBEDDED_INFO;
    const embeddedVersion = typeof raw.embeddedVersion === 'string' ? raw.embeddedVersion : '';
    const isEmbedded = raw.isEmbedded !== false && typeof raw.updateId !== 'string';
    return {
        updateId: typeof raw.updateId === 'string' ? raw.updateId : null,
        // The embedded bundle carries no update.json — its version IS the
        // store-shipped app version.
        version: typeof raw.version === 'string' && raw.version.length > 0
            ? raw.version
            : (isEmbedded ? embeddedVersion : ''),
        embeddedVersion,
        runtimeVersion: typeof raw.runtimeVersion === 'string' ? raw.runtimeVersion : getInstalledRuntimeVersion(),
        isEmbedded,
        isFirstLaunchAfterUpdate: raw.isFirstLaunchAfterUpdate === true,
        didRollBack: raw.didRollBack === true,
        rolledBackUpdateId:
            typeof raw.rolledBackUpdateId === 'string' && raw.rolledBackUpdateId.length > 0
                ? raw.rolledBackUpdateId
                : null,
    };
}

/**
 * Stream the bundle to the native staging slot and verify its SHA-256.
 * Resolves when the update is fully staged for apply; progress arrives on
 * the `__sigxUpdatesEvent` channel (see `events.ts`).
 */
export async function nativeDownload(
    spec: DownloadSpec,
    updateId: string,
    runtimeVersion: string,
    manifestJson: string,
): Promise<void> {
    if (!nativeAvailable()) {
        throw new UpdatesError('native-unavailable', 'Updates native module is not available');
    }
    const result = await callAsync<unknown>(MODULE, 'downloadUpdate', {
        url: spec.url,
        sha256: spec.sha256,
        headers: spec.headers ?? {},
        updateId,
        runtimeVersion,
        manifestJson,
    });
    throwIfNativeError(result, 'download-failed');
}

/** Stage the downloaded update to load on the next cold launch. */
export async function nativeApplyOnNextLaunch(updateId: string): Promise<void> {
    if (!nativeAvailable()) {
        throw new UpdatesError('native-unavailable', 'Updates native module is not available');
    }
    const result = await callAsync<unknown>(MODULE, 'applyOnNextLaunch', updateId);
    throwIfNativeError(result, 'apply-failed');
}

/**
 * Stage + reload the LynxView in place. On success the JS context is torn
 * down, so the returned promise only ever settles on FAILURE.
 */
export async function nativeApplyNow(updateId: string): Promise<void> {
    if (!nativeAvailable()) {
        throw new UpdatesError('native-unavailable', 'Updates native module is not available');
    }
    const result = await callAsync<unknown>(MODULE, 'applyNow', updateId);
    throwIfNativeError(result, 'apply-failed');
}

/** Commit the pending update as healthy (idempotent). */
export async function nativeMarkReady(): Promise<void> {
    if (!nativeAvailable()) return;
    const result = await callAsync<unknown>(MODULE, 'markReady');
    throwIfNativeError(result, 'native-error');
}

/** Configure rollback tuning for subsequent launches. */
export async function nativeSetRollbackOptions(maxFailedLaunches: number): Promise<void> {
    if (!nativeAvailable()) return;
    const result = await callAsync<unknown>(MODULE, 'setRollbackOptions', { maxFailedLaunches });
    throwIfNativeError(result, 'native-error');
}

/** Drop every downloaded update; the baked bundle loads on next launch. */
export async function nativeClearUpdates(): Promise<void> {
    if (!nativeAvailable()) return;
    const result = await callAsync<unknown>(MODULE, 'clearUpdates');
    throwIfNativeError(result, 'native-error');
}
