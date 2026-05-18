/**
 * @sigx/lynx-navigation — type-first native stack router.
 *
 * Phase 0.1 (current): typed registry, stack runtime, NavigationRoot + Stack.
 * Coming next: Screen with slot-based header API, MTS transitions, Tabs.
 */

export { defineRoutes } from './define-routes';
export type { Register, RegisteredRoutes, RouteId, RouteParams, RouteSearch } from './register';
export { useNav } from './hooks/use-nav';
export type { Nav, RoutesWithoutParams, RoutesWithParams } from './hooks/use-nav';
export { useParams } from './hooks/use-params';
export { useSearch } from './hooks/use-search';
export { useHardwareBack } from './hooks/use-hardware-back';
export { useLinkingNav } from './hooks/use-linking-nav';
export type { UseLinkingNavOptions } from './hooks/use-linking-nav';
export { useIsFocused, useFocusEffect } from './hooks/use-focus';
export { useScreenOptions } from './hooks/use-screen-options';
export { useScreenChrome } from './hooks/use-screen-chrome';
export type { ScreenChrome } from './hooks/use-screen-chrome';
export {
    useNavSerializer,
    NAV_SNAPSHOT_VERSION,
} from './hooks/use-nav-serializer';
export type {
    NavSnapshot,
    NavStorageAdapter,
    UseNavSerializerOptions,
} from './hooks/use-nav-serializer';
export { hrefFor, parseHref } from './href';
export type { Href } from './href';
// URL bridge internals: `_setRouteRegistry` is a leading-underscore export —
// intended for tests, deep-link bootstrap before a NavigationRoot mounts, and
// any other integration that needs to seed the registry imperatively.
export { _setRouteRegistry, _clearRouteRegistry } from './url/registry';
export { compilePath } from './url/compile';
export type { CompiledPath } from './url/compile';
export { NavigationRoot } from './components/NavigationRoot';
export { Stack } from './components/Stack';
export { Screen } from './components/Screen';
export { Header } from './components/Header';
export { Tabs, useTabs } from './components/Tabs';
export type { TabInfo, TabsNav } from './components/Tabs';
export { TabBar } from './components/TabBar';
export type { TabRenderContext } from './components/TabBar';
export { Drawer, useDrawer } from './components/Drawer';
export type { DrawerNav } from './components/Drawer';
export { Link } from './components/Link';
export type { LinkProps } from './components/Link';
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
    ScreenOptions,
    ScreenSlotFills,
    SearchOf,
    StackEntry,
    StandardSchemaV1,
    TransitionKind,
    TransitionRole,
    TransitionState,
} from './types';
