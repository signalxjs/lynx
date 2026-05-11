import { component, type Define } from '@sigx/lynx';
import { useNav } from '../hooks/use-nav.js';
import { useNavRoutes } from '../hooks/use-nav-internal.js';
import type { RouteId, RouteParams, RouteSearch } from '../register.js';
import type { RoutesWithParams } from '../hooks/use-nav.js';

/**
 * Per-route conditional props for `<Link>`.
 *
 * Mapped over `RouteId`, then indexed by `RouteId` to flatten into a union.
 * Each branch enforces the `params`-required-iff-route-has-schema rule:
 *
 *   - `<Link to="profile" />`             → TS error (profile requires params)
 *   - `<Link to="profile" params={...} />` → ok
 *   - `<Link to="home" />`                → ok (home has no params)
 *   - `<Link to="home" params={...} />`   → TS error (home accepts no params)
 *
 * Same per-route discrimination as `nav.push`, expressed as a JSX-friendly
 * union rather than overloads.
 */
type LinkPropsByRoute = {
    [K in RouteId]: K extends RoutesWithParams
        ? { to: K; params: RouteParams<K>; search?: RouteSearch<K> }
        : { to: K; params?: undefined; search?: RouteSearch<K> };
}[RouteId];

/**
 * Public type for `<Link>`'s props. The conditional `LinkPropsByRoute` carries
 * the typed `to`/`params`/`search` triple; the rest are simple optionals.
 *
 * `children` is declared explicitly because the public type is exposed via a
 * type-cast (so JSX sees a function-shaped signature). The cast strips sigx's
 * built-in `Define.Slot<'default'>` → JSX-children wiring, so we add a
 * permissive `children?` slot ourselves.
 */
export type LinkProps = LinkPropsByRoute & {
    /** Use `replace` instead of `push` (no new history entry). */
    replace?: boolean;
    /** Link content rendered inside the tappable container. */
    children?: unknown;
};

/**
 * Loose internal props used by the component implementation. The runtime
 * doesn't enforce the per-route conditional — that's a TS-only constraint
 * surfaced via the public `LinkProps` type. The cast at the bottom of this
 * file rewires the export to the strict type.
 */
type LinkPropsLoose =
    & Define.Prop<'to', string, true>
    & Define.Prop<'params', Record<string, unknown> | undefined>
    & Define.Prop<'search', Record<string, unknown> | undefined>
    & Define.Prop<'replace', boolean>
    & Define.Slot<'default'>;

const LinkImpl = component<LinkPropsLoose>(({ props, slots }) => {
    const nav = useNav();
    const routes = useNavRoutes();

    const handlePress = (): void => {
        const route = props.to;
        const routeDef = routes[route];
        if (!routeDef) {
            // Defensive: prop was typed against the registry, so this shouldn't
            // happen at runtime — but if it does (e.g. a stale Link survived a
            // route removal), surface a clear error rather than crashing on
            // the navigator's lookup.
            throw new Error(
                `[lynx-navigation] <Link to='${route}'>: route is not registered.`,
            );
        }
        const hasParams = !!routeDef.params;
        const action = props.replace ? nav.replace : nav.push;
        // Branch on whether the route declares a params schema so positional
        // args land correctly: routes-with-params shift everything one slot
        // (push/replace overload signatures `(name, params, search?, options?)`
        // vs `(name, search?, options?)`). Calling the wrong shape silently
        // puts `search` into the `options` slot.
        if (hasParams) {
            (action as (n: string, p: unknown, s?: unknown) => void)(
                route,
                props.params,
                props.search,
            );
        } else {
            (action as (n: string, s?: unknown) => void)(route, props.search);
        }
    };

    return () => (
        // `bindtap` is correct here because the underlying element is a Lynx
        // native `<view>` — sigx component-level events would use `onPress`.
        <view bindtap={handlePress}>{slots.default?.()}</view>
    );
}, { name: 'Link' });

/**
 * Declarative navigation. Same typing as `nav.push` — pass `params` only when
 * the route declares a schema. Wraps a `<view>` that fires `nav.push` (or
 * `nav.replace` if `replace` is set) on tap.
 *
 * @example
 * ```tsx
 * <Link to="home">Home</Link>
 * <Link to="profile" params={{ id: '42' }}>View profile</Link>
 * <Link to="profile" params={{ id: '42' }} search={{ tab: 'about' }}>About</Link>
 * <Link to="settings" replace>Settings (no back)</Link>
 * ```
 *
 * The cast widens the inferred prop type from the loose impl to the strict
 * `LinkProps` so JSX usage gets per-route discrimination. Runtime is identical.
 */
export const Link = LinkImpl as unknown as (props: LinkProps) => unknown;
