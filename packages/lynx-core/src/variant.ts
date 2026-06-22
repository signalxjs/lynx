/**
 * Active build variant (issue #530).
 *
 * `@sigx/lynx-cli` renders per-environment builds (dev / staging / preview)
 * via `--variant <name>`; the plugin bakes the active name into the bundle as
 * the `__SIGX_VARIANT__` define. This module surfaces it to app code so a build
 * can show a "DEV"/"STAGING" badge or branch behavior by environment.
 *
 * Read via a `typeof` guard so it stays safe under tsgo / vitest / any host
 * where the define didn't run — and must NOT reference `__DEV__` (that define
 * expands to a `process.env` expression that throws in the Lynx BG runtime).
 */

declare const __SIGX_VARIANT__: string | undefined;

/**
 * The active build variant name, or `''` for the base (production) build.
 * e.g. `'dev'`, `'staging'`. Set at build time from `signalx.config.ts`'s
 * `variants` map via `--variant` (or the `SIGX_VARIANT` env var).
 */
export const variant: string =
    typeof __SIGX_VARIANT__ === 'string' ? __SIGX_VARIANT__ : '';

/** True when a build variant is active (i.e. not the base/production build). */
export function isVariant(name?: string): boolean {
    return name === undefined ? variant !== '' : variant === name;
}

/**
 * True for the base build (no `--variant`) — the identity that ships to the
 * store. Note: this reflects the *variant*, not Debug/Release; a release-mode
 * build of a variant still reports `false`.
 */
export function isBaseBuild(): boolean {
    return variant === '';
}
