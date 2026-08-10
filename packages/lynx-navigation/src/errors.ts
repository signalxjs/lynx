/**
 * The package's one error shape and its logger (convention C10).
 *
 * Almost everything this navigator throws is a *programming* error — a hook
 * called outside its provider, a route name that isn't in the registry — so
 * the discriminant matters more than the prose: an app that resolves deep
 * links from untrusted input wants to tell "that URL names a route I don't
 * have" (`route_not_registered`) from "the params didn't validate"
 * (`invalid_params`) without matching on message text.
 */
import { SigxError, createLogger } from '@sigx/lynx-core';

const PKG = 'lynx-navigation';

/** Module diagnostics — reaches the `sigx dev` terminal via the console transport. */
export const log = createLogger(PKG);

/**
 * Stable discriminants for the failures a caller can act on. Read them off
 * `SigxError.code`; the message is for humans and may change.
 */
export type NavigationErrorCode =
    /** A navigator hook/injectable used outside the component that provides it. */
    | 'no_navigator'
    /** URL helpers used before any `<NavigationRoot>` (or `_setRouteRegistry`) ran. */
    | 'no_route_registry'
    /** The route name isn't in the active registry. */
    | 'route_not_registered'
    /** Params failed the route's Standard Schema. */
    | 'invalid_params'
    /** Search failed the route's Standard Schema. */
    | 'invalid_search'
    /** A `path` template that can't be compiled or formatted. */
    | 'invalid_path'
    /** A stack operation with unusable state, e.g. `reset()` with no entries. */
    | 'invalid_stack'
    /** An async Standard Schema on a path the URL bridge resolves synchronously. */
    | 'unsupported_schema';

/** Throw `[@sigx/lynx-navigation] <action> failed: <detail>` with a branchable `code`. */
export function fail(
    code: NavigationErrorCode,
    action: string,
    detail: string,
    options?: { cause?: unknown },
): never {
    throw new SigxError(PKG, code, `[@sigx/${PKG}] ${action} failed: ${detail}`, options);
}
