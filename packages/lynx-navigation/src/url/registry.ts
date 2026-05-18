/**
 * Module-level route registry for the URL bridge.
 *
 * `hrefFor()` and `parseHref()` are designed to be callable from anywhere —
 * including outside the component tree (e.g. deep-link bootstrapping in
 * native bridge code). They can't reach the in-tree `useNavRoutes` injectable
 * directly, so we mirror the active routes here.
 *
 * `<NavigationRoot>` sets this synchronously during setup. Tests that exercise
 * the URL helpers without a NavigationRoot can call `_setRouteRegistry`
 * directly. The leading underscore is a convention: not part of the supported
 * public API (test/integration use only).
 */

import type { CompiledPath } from './compile';
import { compilePath } from './compile';
import type { RouteMap } from '../types';

interface RegistryState {
    readonly routes: RouteMap;
    /** Lazy-compiled paths keyed by route name. */
    readonly compiled: Map<string, CompiledPath>;
}

let current: RegistryState | null = null;

/**
 * Set the active route registry. Called by `<NavigationRoot>` on setup and
 * available to tests/bootstrap code as `_setRouteRegistry`.
 *
 * Last write wins — multi-root apps and rapid mount/unmount cycles in tests
 * always see the most recent `<NavigationRoot>`'s routes. If you need a
 * specific registry for a one-off call, pass it explicitly to the helper
 * (parseHrefWithRoutes / hrefForWithRoutes — currently internal).
 */
export function _setRouteRegistry(routes: RouteMap): void {
    current = { routes, compiled: new Map() };
}

/** Clear the registry. Mainly for tests that want to assert the unset path. */
export function _clearRouteRegistry(): void {
    current = null;
}

/** Get the active registry or throw a friendly error if none is set. */
export function getRouteRegistry(): RegistryState {
    if (!current) {
        throw new Error(
            '[lynx-navigation] No route registry set — render a <NavigationRoot> first, or call _setRouteRegistry() for tests.',
        );
    }
    return current;
}

/**
 * Look up (or lazily compile) the path template for a route name. Returns
 * `null` when the route exists but declares no `path`.
 */
export function getCompiledPath(registry: RegistryState, name: string): CompiledPath | null {
    const def = registry.routes[name];
    if (!def) return null;
    if (!def.path) return null;
    let compiled = registry.compiled.get(name);
    if (!compiled) {
        compiled = compilePath(def.path);
        registry.compiled.set(name, compiled);
    }
    return compiled;
}
