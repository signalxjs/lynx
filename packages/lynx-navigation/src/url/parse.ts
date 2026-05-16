/**
 * URL → typed Href parser.
 *
 * Walks every registered route with a `path`, tries to match its compiled
 * regex against the URL's pathname, and on a hit validates the extracted
 * params + search through the route's Standard Schema. First match wins;
 * iteration order follows `Object.keys` of the registered routes map.
 *
 * Validation failures return `null` rather than throwing — deep-link handlers
 * fall back to the initial route on a bad URL instead of crashing the app.
 */

import type { Href } from '../href.js';
import type { RouteId } from '../register.js';
import { parse as parseUrl } from '@sigx/lynx-linking';
import type { CompiledPath } from './compile.js';
import { parseSearch } from './format.js';
import { getCompiledPath, getRouteRegistry } from './registry.js';
import { validateSync } from './validate.js';

/**
 * Parse a URL string against the active route registry.
 *
 * Accepts both absolute URLs (`myapp://host/users/42?tab=about`) and
 * pathname-only forms (`/users/42?tab=about`). Returns `null` if no route's
 * `path` matches the URL or if schema validation rejects the extracted bits.
 */
export function parseHrefImpl(url: string): Href | null {
    if (typeof url !== 'string' || url.length === 0) return null;

    // Use lynx-linking's parser for the scheme/host split — but accept paths
    // that don't have a scheme too (raw `/users/42` is the common case from
    // in-app routing).
    const { pathname, query } = splitPathAndQuery(url);
    if (!pathname) return null;

    const registry = getRouteRegistry();
    const rawSearch = parseSearch(query);

    for (const name of Object.keys(registry.routes)) {
        const compiled = getCompiledPath(registry, name);
        if (!compiled) continue;
        const match = compiled.regex.exec(pathname);
        if (!match) continue;

        const rawParams = extractParams(compiled, match);
        const def = registry.routes[name];

        const paramsOutcome = validateSync(def.params, rawParams);
        if (!paramsOutcome.ok) continue;
        const searchOutcome = validateSync(def.search, rawSearch);
        if (!searchOutcome.ok) continue;

        return {
            route: name as RouteId,
            params: paramsOutcome.value as Record<string, never>,
            search: searchOutcome.value as Record<string, never>,
            url,
        };
    }
    return null;
}

function extractParams(
    compiled: CompiledPath,
    match: RegExpExecArray,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < compiled.paramNames.length; i++) {
        const raw = match[i + 1];
        try {
            out[compiled.paramNames[i]] = decodeURIComponent(raw);
        } catch {
            out[compiled.paramNames[i]] = raw;
        }
    }
    return out;
}

function splitPathAndQuery(url: string): { pathname: string; query: string } {
    // Drop the fragment before any path/query work — `#…` is a client-side
    // anchor that must not leak into the route pathname or query values.
    const hashIdx = url.indexOf('#');
    const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;

    // If the URL has a scheme, defer to lynx-linking's parser — handles
    // `myapp://host/path?q` correctly. Otherwise treat the whole thing as
    // pathname+query.
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(noHash);
    if (hasScheme) {
        const parsed = parseUrl(noHash);
        // Reconstruct the query string from the already-parsed bag. We have
        // to do this because parseUrl decoded keys/values, but parseSearch
        // expects encoded form. Simpler: split the original ourselves.
        const qIdx = noHash.indexOf('?');
        const query = qIdx >= 0 ? noHash.slice(qIdx + 1) : '';
        return { pathname: parsed.path, query };
    }
    const qIdx = noHash.indexOf('?');
    if (qIdx === -1) return { pathname: noHash, query: '' };
    return { pathname: noHash.slice(0, qIdx), query: noHash.slice(qIdx + 1) };
}
