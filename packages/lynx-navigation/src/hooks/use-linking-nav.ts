import { onMounted } from '@sigx/lynx';
import { Linking } from '@sigx/lynx-linking';
import { parseHref, type Href } from '../href';
import { useNav, type Nav } from './use-nav';
import { useNavRoutes } from './use-nav-internal';
import type { RouteMap } from '../types';

export interface UseLinkingNavOptions {
    /**
     * Schemes/prefixes to strip before parsing. Matched in order; the first
     * match wins. Example: `['myapp://', 'https://myapp.com']` lets
     * `https://myapp.com/users/42` parse against the same routes as
     * `/users/42`.
     *
     * After stripping, a leading `/` is added if missing so the result is a
     * valid pathname.
     */
    prefixes?: string[];

    /**
     * Custom handler invoked instead of the default dispatch. Use this when
     * you need to intercept (e.g. for auth callbacks, analytics) before
     * routing. If you call `nav.push` / `nav.replace` from here, the default
     * dispatch is skipped — return `void`.
     */
    onURL?: (url: string, nav: Nav) => void;

    /**
     * Called when an incoming URL doesn't match any registered route's `path`
     * template (or fails schema validation). Defaults to a no-op so unknown
     * URLs are dropped silently. Use this to surface "page not found" UX or
     * to forward to a catch-all route.
     */
    onUnmatched?: (url: string) => void;

    /**
     * Whether to use `nav.replace` instead of `nav.push` for the cold-start
     * initial URL. Defaults to `true` — restoring an app into a deep link
     * shouldn't leave a stray "initial route" entry beneath it that the back
     * button can return to.
     *
     * Runtime URLs (from `addEventListener`) always `push`.
     */
    replaceInitial?: boolean;
}

/**
 * Bridge `@sigx/lynx-linking` URL events into a `@sigx/lynx-navigation`
 * navigator. Call once inside a `<NavigationRoot>` subtree.
 *
 * Handles both delivery modes:
 *   - **cold start** — `Linking.getInitialURL()` is read on mount and, if
 *     present, dispatched (replacing the initial route by default).
 *   - **warm start** — `Linking.addEventListener('url', ...)` subscribes for
 *     URLs delivered while the app is already running; each one is pushed.
 *
 * URL → route dispatch goes through `parseHref`, which matches the URL's
 * pathname against the route registry seeded by `<NavigationRoot>`. Routes
 * without a `path` template are never matched by deep links — only typed
 * `<Link>` / `nav.push` calls reach them.
 *
 * @example
 * ```tsx
 * import { useLinkingNav } from '@sigx/lynx-navigation';
 *
 * const DeepLinks = component(() => {
 *     useLinkingNav({
 *         prefixes: ['myapp://', 'https://myapp.com'],
 *         onUnmatched: (url) => console.warn('Unknown deep link:', url),
 *     });
 *     return () => null;
 * });
 *
 * <NavigationRoot routes={routes}>
 *     <DeepLinks />
 *     <Stack />
 * </NavigationRoot>
 * ```
 */
export function useLinkingNav(opts: UseLinkingNavOptions = {}): void {
    const nav = useNav();
    const routes = useNavRoutes();

    const dispatch = (url: string, kind: 'push' | 'replace'): void => {
        if (opts.onURL) {
            opts.onURL(url, nav);
            return;
        }
        const stripped = _stripPrefix(url, opts.prefixes);
        const href = parseHref(stripped);
        if (!href) {
            opts.onUnmatched?.(url);
            return;
        }
        _navigateToHref(nav, routes, href, kind);
    };

    onMounted(() => {
        const initial = Linking.getInitialURL();
        if (initial) {
            dispatch(initial, opts.replaceInitial === false ? 'push' : 'replace');
        }
        const sub = Linking.addEventListener('url', (e) => dispatch(e.url, 'push'));
        return () => sub.remove();
    });
}

/**
 * Strip the first matching prefix from `url`, returning a pathname-like
 * string. If no prefixes are provided, or none match, the original URL is
 * returned unchanged so `parseHref` can still handle scheme-prefixed forms
 * via `@sigx/lynx-linking`'s `parse`.
 *
 * Exported for unit testing — not part of the package public API.
 */
export function _stripPrefix(url: string, prefixes?: string[]): string {
    if (!prefixes || prefixes.length === 0) return url;
    for (const prefix of prefixes) {
        if (url.startsWith(prefix)) {
            const rest = url.slice(prefix.length);
            return rest.startsWith('/') ? rest : `/${rest}`;
        }
    }
    return url;
}

/**
 * Call the right `nav.push` / `nav.replace` overload for `href`. The
 * overloads differ in positional layout: routes with a params schema take
 * `(name, params, search?, options?)`; routes without take `(name, search?,
 * options?)`. Calling the wrong shape silently shifts `search` into the
 * `options` slot, so we look the route up in the registry and branch.
 *
 * Exported for unit testing — not part of the package public API.
 */
export function _navigateToHref(
    nav: Nav,
    routes: RouteMap,
    href: Href,
    kind: 'push' | 'replace',
): void {
    const def = routes[href.route];
    // Defensive: `parseHref` already validated against the registry, so this
    // really shouldn't happen — but if the registry was cleared between
    // parse and dispatch (multi-NavigationRoot scenarios), bail rather than
    // throw.
    if (!def) return;
    const hasParams = !!def.params;
    const action = kind === 'replace' ? nav.replace : nav.push;
    if (hasParams) {
        (action as (n: string, p: unknown, s?: unknown) => void)(
            href.route,
            href.params,
            href.search,
        );
    } else {
        (action as (n: string, s?: unknown) => void)(href.route, href.search);
    }
}
