import { component, defineProvide, onMounted, onUnmounted, useSharedValue, type Define } from '@sigx/lynx';
import { createNavigatorState } from '../navigator/core.js';
import { useNav } from '../hooks/use-nav.js';
import { wireHardwareBack } from '../hooks/use-hardware-back.js';
import { useNavInternals, useNavRoutes } from '../hooks/use-nav-internal.js';
import type { RouteId } from '../register.js';
import type { Presentation, RouteMap, StackEntry } from '../types.js';
import { _setRouteRegistry } from '../url/registry.js';

type NavigationRootProps =
    & Define.Prop<'routes', RouteMap, true>
    & Define.Prop<'initialRoute', RouteId>
    & Define.Prop<'initialParams', Record<string, unknown>>
    & Define.Prop<'initialSearch', Record<string, unknown>>
    /**
     * Enable slide-from-right transitions on push/pop. Defaults to true.
     * Tests against `@sigx/lynx-testing` (which doesn't have an MT runtime)
     * should pass `animated={false}` so navigations commit synchronously.
     */
    & Define.Prop<'animated', boolean>
    /**
     * Enable the iOS-style edge-swipe-back gesture. Defaults to true. Set
     * to false if it conflicts with screen content on the leftmost 20px,
     * or while debugging gesture issues.
     */
    & Define.Prop<'edgeSwipeEnabled', boolean>
    /**
     * Subscribe the Android hardware back button / system back gesture to
     * this navigator. Defaults to true — a back press pops the deepest
     * focused stack, falling through to `exitApp()` only at the base entry.
     * Set to false to handle hardware back yourself (then call
     * `useHardwareBack()` in your own component). No-op on iOS.
     */
    & Define.Prop<'hardwareBack', boolean>
    & Define.Slot<'default'>;

/**
 * Root of a navigator subtree.
 *
 * Creates a fresh `NavigatorState` from `routes` and provides it via
 * `defineProvide`, so descendant `<Stack>` / `<Screen>` components and any
 * `useNav()` / `useParams()` calls resolve through this instance.
 *
 * The bottom-of-stack entry is built from `initialRoute` (defaults to the
 * first key in `routes`). For routes that declare a params schema, you must
 * pass `initialParams` matching that schema.
 *
 * Mirrors the install pattern of `@sigx/router` (see
 * `packages/router/src/router.ts:519-528`), but at component scope rather than
 * `app.use(router)` — no app-wide singleton, so multi-navigator apps and
 * tests get isolated state for free.
 */
export const NavigationRoot = component<NavigationRootProps>(({ props, slots }) => {
    const routes = props.routes;
    const initialName: string = props.initialRoute ?? Object.keys(routes)[0];
    if (!routes[initialName]) {
        throw new Error(
            `[lynx-navigation] <NavigationRoot> initialRoute='${initialName}' is not in the routes registry.`,
        );
    }
    // Publish the active route registry to the URL bridge so module-level
    // `hrefFor` / `parseHref` callers (deep-link handlers, anything outside
    // the component tree) resolve against this navigator's routes. Last
    // mount wins — multi-root apps that need isolation should call the
    // URL helpers with explicit context (TBD post-1.0).
    _setRouteRegistry(routes);
    const initialPresentation: Presentation = routes[initialName].presentation ?? 'card';
    const initial: StackEntry = {
        key: 'root',
        route: initialName,
        params: props.initialParams ?? {},
        search: props.initialSearch ?? {},
        state: undefined,
        presentation: initialPresentation,
    };

    // SharedValue driving the slide-from-right push/pop transition. Created
    // unconditionally (hooks must be) but only forwarded into the navigator
    // when animations are enabled — `createNavigatorState` falls back to
    // instant swaps when `progress` is undefined.
    const progressSv = useSharedValue(0);
    const animationsEnabled = props.animated !== false;
    const navState = createNavigatorState({
        routes,
        initial,
        progress: animationsEnabled ? progressSv : undefined,
    });

    defineProvide(useNav, () => navState.nav);
    defineProvide(useNavRoutes, () => navState.routes);
    const edgeSwipeEnabled = props.edgeSwipeEnabled !== false;
    defineProvide(useNavInternals, () => ({
        progress: animationsEnabled ? progressSv : null,
        beginBackGesture: navState._gesture.beginBackGesture,
        commitBackGesture: navState._gesture.commitBackGesture,
        cancelBackGesture: navState._gesture.cancelBackGesture,
        edgeSwipeEnabled,
        screens: navState._screens,
    }));

    // Auto-wire Android hardware/system back unless opted out. Without this,
    // the OS back gesture fires `hardwareBackPress` but nothing pops — every
    // app would otherwise have to remember to call `useHardwareBack()`.
    // Idempotent per tree (see `wireHardwareBack`), so a manual call still
    // works and never double-pops. No-op on iOS / non-native runtimes.
    if (props.hardwareBack !== false) {
        let dispose: () => void = () => {};
        onMounted(() => { dispose = wireHardwareBack(navState.nav); });
        onUnmounted(() => { dispose(); });
    }

    return () => slots.default?.();
});
