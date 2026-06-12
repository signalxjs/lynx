/**
 * JS side of the `Updates` native module — thin promise wrappers over the
 * callback-based bridge, plus the build-time defines baked by
 * `@sigx/lynx-plugin`.
 *
 * Every wrapper degrades gracefully when the module is absent (web preview,
 * tests, app built without the package): reads return inert defaults,
 * mutations reject with `native-unavailable`.
 */

import { callAsync, callSync, isModuleAvailable } from '@sigx/lynx-core';
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
    return 'android';
}

const EMBEDDED_INFO: CurrentUpdateInfo = {
    updateId: null,
    version: '',
    runtimeVersion: 'unknown',
    isEmbedded: true,
    isFirstLaunchAfterUpdate: false,
    didRollBack: false,
};

interface NativeError {
    error?: string;
    code?: string;
}

function throwIfNativeError(result: unknown, code: UpdatesError['code']): void {
    const err = result as NativeError | null;
    if (err && typeof err === 'object' && typeof err.error === 'string') {
        throw new UpdatesError(
            (err.code as UpdatesError['code']) ?? code,
            err.error,
        );
    }
}

export async function getCurrentUpdate(): Promise<CurrentUpdateInfo> {
    if (!nativeAvailable()) return EMBEDDED_INFO;
    const raw = await callAsync<Partial<CurrentUpdateInfo> | null>(MODULE, 'getCurrentUpdate');
    if (!raw || typeof raw !== 'object') return EMBEDDED_INFO;
    return {
        updateId: typeof raw.updateId === 'string' ? raw.updateId : null,
        version: typeof raw.version === 'string' ? raw.version : '',
        runtimeVersion: typeof raw.runtimeVersion === 'string' ? raw.runtimeVersion : getInstalledRuntimeVersion(),
        isEmbedded: raw.isEmbedded !== false && typeof raw.updateId !== 'string',
        isFirstLaunchAfterUpdate: raw.isFirstLaunchAfterUpdate === true,
        didRollBack: raw.didRollBack === true,
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
    await callAsync<unknown>(MODULE, 'markReady');
}

/** Configure rollback tuning for subsequent launches. */
export async function nativeSetRollbackOptions(maxFailedLaunches: number): Promise<void> {
    if (!nativeAvailable()) return;
    await callAsync<unknown>(MODULE, 'setRollbackOptions', { maxFailedLaunches });
}

/** Drop every downloaded update; the baked bundle loads on next launch. */
export async function nativeClearUpdates(): Promise<void> {
    if (!nativeAvailable()) return;
    await callAsync<unknown>(MODULE, 'clearUpdates');
}
