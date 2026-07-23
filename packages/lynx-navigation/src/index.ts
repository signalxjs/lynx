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
export { useSheetHeight } from './hooks/use-sheet-height.js';
export { useParams } from './hooks/use-params.js';
export { useSearch } from './hooks/use-search.js';
export { useHardwareBack } from './hooks/use-hardware-back.js';
export { useLinkingNav } from './hooks/use-linking-nav.js';
export type { UseLinkingNavOptions } from './hooks/use-linking-nav.js';
export { useIsFocused, useFocusEffect } from './hooks/use-focus.js';
export { useScreenOptions } from './hooks/use-screen-options.js';
export { useScreenChrome } from './hooks/use-screen-chrome.js';
export type { ScreenChrome } from './hooks/use-screen-chrome.js';
export {
    useNavSerializer,
    NAV_SNAPSHOT_VERSION,
} from './hooks/use-nav-serializer.js';
export type {
    NavSnapshot,
    NavStorageAdapter,
    UseNavSerializerOptions,
} from './hooks/use-nav-serializer.js';
export { hrefFor, parseHref } from './href.js';
export type { Href } from './href.js';
// URL bridge internals: `_setRouteRegistry` is a leading-underscore export —
// intended for tests, deep-link bootstrap before a NavigationRoot mounts, and
// any other integration that needs to seed the registry imperatively.
export { _setRouteRegistry, _clearRouteRegistry } from './url/registry.js';
export { compilePath } from './url/compile.js';
export type { CompiledPath } from './url/compile.js';
export { NavigationRoot } from './components/NavigationRoot.js';
export { Stack } from './components/Stack.js';
export { Screen } from './components/Screen.js';
export { Header } from './components/Header.js';
export { Tabs, useTabs } from './components/Tabs.js';
export type { TabInfo, TabsNav } from './components/Tabs.js';
export { TabBar } from './components/TabBar.js';
export type { TabRenderContext } from './components/TabBar.js';
export { Drawer, useDrawer } from './components/Drawer.js';
export type { DrawerNav } from './components/Drawer.js';
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
    ScreenOptions,
    ScreenSlotFills,
    SearchOf,
    StackEntry,
    StandardSchemaV1,
    TransitionKind,
    TransitionRole,
    TransitionState,
} from './types.js';
