/**
 * Typed → URL: build the `url` field of an Href from a route's params/search.
 *
 * Mirror of parse.ts. Used by `hrefFor()` after schema validation succeeds.
 */

import { formatSearch } from './format.js';
import { getCompiledPath, getRouteRegistry } from './registry.js';

/**
 * Build the URL form of a route + params + search, or `null` if the route
 * declares no `path` template (typed navigation still works — only deep-link
 * serialization is unavailable).
 *
 * Params must already be valid for the route's schema (callers run this after
 * `validateSync`). Search values are stringified as-is — schema-validated
 * inputs survive round-tripping because `parseHref` re-runs the same schema.
 */
export function buildUrl(
    routeName: string,
    params: Record<string, unknown> | undefined,
    search: Record<string, unknown> | undefined,
): string | null {
    const registry = getRouteRegistry();
    const compiled = getCompiledPath(registry, routeName);
    if (!compiled) return null;
    const formatted = compiled.format(
        // The compiler accepts string|number; we widen to unknown and let it
        // String()-coerce. Booleans/null get filtered by the missing-param
        // check, which is what we want — boolean path params don't exist.
        (params ?? {}) as Record<string, string | number>,
    );
    const querystring = formatSearch(search);
    return querystring.length > 0 ? `${formatted}?${querystring}` : formatted;
}
