/**
 * @sigx/lynx-navigation — type-first native stack router.
 *
 * Phase 0.1 (current): typed registry, stack runtime, NavigationRoot + Stack.
 * Coming next: Screen with slot-based header API, MTS transitions, Tabs.
 */

export { defineRoutes } from './define-routes.js';
export type { Register, RegisteredRoutes, RouteId, RouteParams, RouteSearch } from './register.js';
export { useNav } from './hooks/use-nav.js';
export type { Nav, RoutesWithoutParams, RoutesWithParams } from './hooks/use-nav.js';
export { useParams } from './hooks/use-params.js';
export { useSearch } from './hooks/use-search.js';
export { useHardwareBack } from './hooks/use-hardware-back.js';
export { hrefFor, parseHref } from './href.js';
export type { Href } from './href.js';
export { NavigationRoot } from './components/NavigationRoot.js';
export { Stack } from './components/Stack.js';
export { Link } from './components/Link.js';
export type { LinkProps } from './components/Link.js';
export type {
    ComponentLike,
    EmptyParams,
    InferOutput,
    ParamsOf,
    PopOptions,
    Presentation,
    PushOptions,
    RouteDefinition,
    RouteMap,
    RouteRequiresParams,
    SearchOf,
    StackEntry,
    StandardSchemaV1,
    TransitionKind,
    TransitionRole,
    TransitionState,
} from './types.js';
