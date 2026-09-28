/**
 * App environment (issue #1244).
 *
 * The `env` block of `signalx.config.ts` — typed build-time settings such as
 * the API base URL or feature flags, with the active `--variant`'s overrides
 * merged in. `@sigx/lynx-plugin` bakes it into the bundle (OTA bundles
 * included) as the `__SIGX_APP_ENV__` define; this module surfaces it to app
 * code.
 *
 * Typed through the global {@link SigxAppEnv} interface, which the app extends
 * once from its config:
 *
 * ```ts
 * // src/sigx-env.d.ts
 * import type config from '../signalx.config';
 * import type { EnvOf } from '@sigx/lynx-cli/config';
 * declare global { interface SigxAppEnv extends EnvOf<typeof config> {} }
 * export {};
 * ```
 *
 * Read via a `typeof` guard so it stays safe under tsgo / vitest / any host
 * where the define didn't run — and must NOT reference `__DEV__` (that define
 * expands to a `process.env` expression that throws in the Lynx BG runtime).
 */

declare global {
    /**
     * Shape of the app {@link env}. Empty until the app extends it from its
     * `signalx.config.ts` via `EnvOf<typeof config>` (see `@sigx/lynx-cli`).
     */
    interface SigxAppEnv {}
}

declare const __SIGX_APP_ENV__: SigxAppEnv | undefined;

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
}

/**
 * The app env from `signalx.config.ts` (`env`, merged with the active
 * variant's `env`), frozen. `{}` when the app declares none.
 *
 * Everything here ships inside the app bundle — never put secrets in it.
 */
export const env: Readonly<SigxAppEnv> = deepFreeze(
    typeof __SIGX_APP_ENV__ === 'object' && __SIGX_APP_ENV__ !== null ? __SIGX_APP_ENV__ : {},
);
