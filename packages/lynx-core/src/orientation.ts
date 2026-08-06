import { callAsync, isModuleAvailable } from './bridge.js';

/**
 * Runtime orientation control (#856) — the imperative half of the rotation
 * surface. The reactive half (what orientation are we in, how big is the
 * viewport) lives in `./screen.ts`.
 *
 * Served by core's own native module (`SigxCore`) because the lock lever is
 * the host Activity / window scene, which core already reaches through
 * `SigxActivityHolder` (Android) and `SigxPresentation` (iOS).
 */
const MODULE = 'SigxCore';

/**
 * A runtime orientation request.
 *
 * - `'portrait'` / `'landscape'` — lock to that axis. `'landscape'` allows
 *   either landscape (the device may still flip between them); pick
 *   `'landscape-left'` / `'landscape-right'` to pin one.
 * - `'all'` — every orientation, including upside-down portrait.
 * - `'default'` — release the runtime lock and fall back to whatever
 *   `signalx.config.ts`'s `orientation` declared. Same as {@link Orientation.unlock}.
 */
export type OrientationLock =
    | 'portrait'
    | 'portrait-upside-down'
    | 'landscape'
    | 'landscape-left'
    | 'landscape-right'
    | 'all'
    | 'default';

/**
 * `callAsync` has no error channel — it rejects only when the *synchronous*
 * bridge call throws — so native-side failures arrive on the resolved callback
 * as `{ error }` (CONVENTIONS.md C4). Rethrow with the full scope prefix (C10).
 */
async function request(action: string, method: string, args: unknown[]): Promise<void> {
    const res = await callAsync<{ error?: string } | undefined>(MODULE, method, ...args);
    if (res?.error) {
        throw new Error(`[@sigx/lynx-core] ${action} failed: ${res.error}`);
    }
}

/**
 * Runtime orientation lock.
 *
 * **The build-time config is the ceiling.** `signalx.config.ts`'s `orientation`
 * (default `'portrait'`) is written into `android:screenOrientation` and iOS's
 * `UISupportedInterfaceOrientations`; the OS will not rotate outside that set
 * no matter what you ask for at runtime. Requesting an orientation the app
 * didn't declare **rejects** with a message naming the config change needed —
 * it is a build misconfiguration, not a runtime condition to handle. Set
 * `orientation: 'default'` (portrait + both landscapes) or `'all'` to make
 * runtime locking meaningful.
 *
 * On iOS 15 a lock takes effect on the next physical rotation rather than
 * snapping immediately: forcing rotation needs `requestGeometryUpdate`, which
 * is iOS 16+. Raise `ios.deploymentTarget` to `'16.0'` for the immediate flip.
 *
 * @example
 * ```ts
 * import { Orientation } from '@sigx/lynx';
 *
 * await Orientation.lock('landscape');   // video player
 * await Orientation.unlock();            // back to the configured set
 * ```
 *
 * Prefer `useOrientationLock()` from `@sigx/lynx` when the lock should last
 * exactly as long as one screen is mounted.
 */
export const Orientation = {
    /** Request an orientation lock. Rejects if `to` isn't in the app's declared set. */
    lock(to: OrientationLock): Promise<void> {
        return request(`lock('${to}')`, 'lockOrientation', [{ orientation: to }]);
    },

    /** Release the runtime lock, restoring the build-time configured set. */
    unlock(): Promise<void> {
        return request('unlock', 'unlockOrientation', []);
    },

    /** Feature-detect the native module without throwing. */
    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
