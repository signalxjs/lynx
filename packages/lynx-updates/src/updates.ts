/**
 * Public API — `defineUpdates()` (the boot-time declaration, in the
 * `defineApp`/`defineRoutes` family) and the `Updates` runtime object (a
 * thin facade over the controller, the store and the native module, in the
 * `Haptics`/`Storage` native-module family). See the package README.
 */

import * as controller from './controller.js';
import { getCurrentUpdate, nativeAvailable } from './native.js';
import { addListener, getStateSnapshot } from './state.js';
import type {
    CurrentUpdateInfo,
    UpdateCheckResult,
    UpdateManifest,
    UpdatesConfig,
    UpdatesEvent,
    UpdatesState,
} from './types.js';

/**
 * Declare the OTA update behavior for this app. Call once in `main.tsx`
 * before `defineApp` — idempotent and synchronous; re-declaring updates the
 * config but never re-runs the boot work (markReady / launch check).
 * Kicks off the configured mode's automatic behavior on a deferred task
 * (never blocks first paint). No-ops gracefully (with one warning) when the
 * native module is absent (web preview, tests).
 *
 * @example
 * ```tsx
 * defineUpdates({ provider: { url: 'https://cdn.example.com/updates.json' } });
 * defineApp(<App />).mount(null);
 * ```
 */
export function defineUpdates(config: UpdatesConfig): void {
    controller.configure(config);
}

export const Updates = {
    /** Ask the provider for the best available update. Works in every mode. */
    checkForUpdate(): Promise<UpdateCheckResult> {
        return controller.checkForUpdate();
    },

    /**
     * Download + stage the given (or last-checked) update. Resolves when the
     * update is verified on disk and staged for the next launch.
     */
    download(manifest?: UpdateManifest): Promise<void> {
        return controller.download(manifest);
    },

    /**
     * Apply the staged update NOW via an in-place reload. On success the JS
     * context is torn down, so this promise only ever rejects (on failure —
     * the update stays staged for next launch).
     */
    apply(): Promise<void> {
        return controller.apply();
    },

    /**
     * Health signal: commits the pending update so native stops counting
     * launch attempts against it. Called automatically after defineUpdates()
     * unless `autoMarkReady: false`. Safe to call repeatedly.
     */
    markReady(): Promise<void> {
        return controller.markReady();
    },

    /** What this process is running (embedded vs. OTA, rollback flags). */
    getCurrentlyRunning(): Promise<CurrentUpdateInfo> {
        return getCurrentUpdate();
    },

    /** Drop all downloaded updates; the baked bundle loads on next launch. */
    clearUpdates(): Promise<void> {
        return controller.clearUpdates();
    },

    /** Snapshot of the reactive state (see `useUpdates()` for the live view). */
    getState(): UpdatesState {
        return getStateSnapshot();
    },

    /** Subscribe to update lifecycle events. Returns an unsubscribe fn. */
    addListener(fn: (event: UpdatesEvent) => void): () => void {
        return addListener(fn);
    },

    /** True when the native Updates module is present in this runtime. */
    isAvailable(): boolean {
        return nativeAvailable();
    },
} as const;
