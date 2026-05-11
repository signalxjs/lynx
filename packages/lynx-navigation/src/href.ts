import type { RouteId, RouteParams, RouteSearch } from './register.js';
import type { RoutesWithoutParams, RoutesWithParams } from './hooks/use-nav.js';

/**
 * A typed reference to a navigation target — what `<Link to={...}>` consumes
 * and what `hrefFor()` produces.
 *
 * Holds both the typed pieces (route name, params, search) and the serialized
 * URL form (when the route declares a `path` template). Either side can drive
 * navigation — typed for in-app links, URL for deep links / sharing.
 */
export interface Href<K extends RouteId = RouteId> {
    readonly route: K;
    readonly params: RouteParams<K>;
    readonly search: RouteSearch<K>;
    /** URL form. `null` when the route declares no `path` template. */
    readonly url: string | null;
}

/**
 * Build a typed Href for a given route. Validates params against the route's
 * schema at runtime; type-checks them at compile time.
 *
 * Overloaded the same way as `nav.push` — one signature for routes without a
 * params schema, one for routes that require params. See `RoutesWithParams`
 * in `./hooks/use-nav.js` for why this isn't expressed as a single conditional.
 *
 * @example
 * ```ts
 * hrefFor('profile', { id: '42' });               // → { route, params, search: {}, url: '/users/42' }
 * hrefFor('profile', { id: '42' }, { tab: 'about' });
 * hrefFor('home');                                // params arg omitted (no schema)
 * ```
 */
export function hrefFor<K extends RoutesWithoutParams>(name: K, search?: RouteSearch<K>): Href<K>;
export function hrefFor<K extends RoutesWithParams>(
    name: K,
    params: RouteParams<K>,
    search?: RouteSearch<K>,
): Href<K>;
export function hrefFor(name: string, ..._args: unknown[]): Href {
    void name;
    void _args;
    throw new Error(
        'hrefFor() runtime is not implemented yet — this is the type spike.',
    );
}

/**
 * Parse a URL string into a typed Href against the registered routes.
 * Returns `null` if no route's `path` template matches.
 */
export function parseHref(url: string): Href | null {
    void url;
    throw new Error(
        'parseHref() runtime is not implemented yet — this is the type spike.',
    );
}
