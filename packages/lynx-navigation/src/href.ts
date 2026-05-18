import type { RouteId, RouteParams, RouteSearch } from './register';
import type { RoutesWithoutParams, RoutesWithParams } from './hooks/use-nav';
import { buildUrl } from './url/build';
import { parseHrefImpl } from './url/parse';
import { getRouteRegistry } from './url/registry';
import { validateSync } from './url/validate';

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
 * Requires a `<NavigationRoot>` (or an explicit `_setRouteRegistry` call) to
 * have run — the URL form is built against the active route registry. The
 * typed pieces (`route`, `params`, `search`) are returned regardless; `url`
 * is `null` when the route declares no `path` template.
 *
 * Schema validation errors throw — pass already-validated values from
 * `useParams` / `useSearch` to round-trip safely, or wrap in try/catch when
 * building hrefs from external input.
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
export function hrefFor(name: string, ...args: unknown[]): Href {
    const registry = getRouteRegistry();
    const def = registry.routes[name];
    if (!def) {
        throw new Error(
            `[lynx-navigation] hrefFor('${name}'): route is not in the active registry.`,
        );
    }

    // Disambiguate the overloads: routes with a params schema get
    // (name, params, search?); routes without get (name, search?). The
    // typed overloads enforce this at compile time, but at runtime we need
    // to peek at the schema presence to know how to interpret `args`.
    const hasParamsSchema = !!def.params;
    let rawParams: Record<string, unknown> | undefined;
    let rawSearch: Record<string, unknown> | undefined;
    if (hasParamsSchema) {
        rawParams = args[0] as Record<string, unknown> | undefined;
        rawSearch = args[1] as Record<string, unknown> | undefined;
    } else {
        rawParams = undefined;
        rawSearch = args[0] as Record<string, unknown> | undefined;
    }

    const paramsOutcome = validateSync(def.params, rawParams ?? {});
    if (!paramsOutcome.ok) {
        throw new Error(
            `[lynx-navigation] hrefFor('${name}'): params validation failed — ${paramsOutcome.issues.join('; ')}`,
        );
    }
    const searchOutcome = validateSync(def.search, rawSearch ?? {});
    if (!searchOutcome.ok) {
        throw new Error(
            `[lynx-navigation] hrefFor('${name}'): search validation failed — ${searchOutcome.issues.join('; ')}`,
        );
    }

    const params = paramsOutcome.value as Record<string, unknown>;
    const search = searchOutcome.value as Record<string, unknown>;
    const url = buildUrl(name, params, search);

    return {
        route: name as RouteId,
        params: params as never,
        search: search as never,
        url,
    };
}

/**
 * Parse a URL string into a typed Href against the registered routes.
 * Returns `null` if no route's `path` template matches the URL or if the
 * extracted params/search fail the route's schema validation.
 *
 * Accepts both absolute (`myapp://host/path?q`) and pathname-only
 * (`/path?q`) forms — the pathname is matched against each route's
 * compiled template. Iteration order is the registration order; first match
 * wins.
 */
export function parseHref(url: string): Href | null {
    return parseHrefImpl(url);
}
