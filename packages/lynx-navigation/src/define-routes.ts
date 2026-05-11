import type { RouteMap } from './types.js';

/**
 * Define a typed route registry.
 *
 * Returns the input verbatim at runtime — the function exists for TypeScript
 * inference. The returned type is narrowed to the literal route map so that
 * downstream APIs (`useNav`, `useParams`, `<Link>`) can extract route names
 * and params/search schemas precisely.
 *
 * @example
 * ```ts
 * import { defineRoutes } from '@sigx/lynx-navigation';
 * import { z } from 'zod';
 *
 * export const routes = defineRoutes({
 *     home: { component: lazy(() => import('./Home')) },
 *     profile: {
 *         params: z.object({ id: z.string() }),
 *         component: lazy(() => import('./Profile')),
 *         path: '/users/:id',
 *     },
 * });
 *
 * // Then in app entry:
 * declare module '@sigx/lynx-navigation' {
 *     interface Register { routes: typeof routes }
 * }
 * ```
 */
export function defineRoutes<const T extends RouteMap>(routes: T): T {
    return routes;
}
