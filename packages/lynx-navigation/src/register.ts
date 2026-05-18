import type { ParamsOf, RouteMap, SearchOf } from './types';

/**
 * Module-augmentation surface for the user's typed route map.
 *
 * Apps register their routes by augmenting this interface — the rest of the
 * library's typed APIs (useNav, useParams, useSearch, <Link>) read from
 * `RegisteredRoutes` so all inference is global.
 *
 * @example
 * ```ts
 * // In your app's main.ts (or a routes.ts that's imported early):
 * import type { routes } from './routes';
 *
 * declare module '@sigx/lynx-navigation' {
 *     interface Register { routes: typeof routes }
 * }
 * ```
 *
 * If `Register.routes` is not augmented the library falls back to a permissive
 * `RouteMap` so non-augmented usage still type-checks (just without precise
 * inference). The recommended pattern is always to augment.
 */
export interface Register {
    // Intentionally empty — users augment with `routes: typeof routes`.
}

/**
 * The user's registered route map, or a permissive fallback when not
 * augmented. All higher-level types derive from this.
 */
export type RegisteredRoutes = Register extends { routes: infer R } ? R : RouteMap;

/** Union of registered route names (string literal union when registered). */
export type RouteId = keyof RegisteredRoutes & string;

/** Params type for a registered route name. */
export type RouteParams<K extends RouteId> = ParamsOf<RegisteredRoutes[K]>;

/** Search type for a registered route name. */
export type RouteSearch<K extends RouteId> = SearchOf<RegisteredRoutes[K]>;
