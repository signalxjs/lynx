import {
    component,
    defineProvide,
    effect,
    onUnmounted,
    untrack,
    useSharedValue,
    type ComponentFactory,
    type Define,
    type SharedValue,
} from '@sigx/lynx';
import { Suspense, isLazyComponent } from '@sigx/lynx';
import { createNavigatorState } from '../navigator/core.js';
import { useNav, type Nav } from '../hooks/use-nav.js';
import {
    useCurrentEntry,
    useNavInternals,
    useNavRoutes,
    type NavInternals,
} from '../hooks/use-nav-internal.js';
import type { Presentation, StackEntry } from '../types.js';
import { ScreenContainer } from './ScreenContainer.js';
import { EdgeBackHandle } from './EdgeBackHandle.js';
import { EntryScope } from './EntryScope.js';
import { useTabScreenName, useTabs } from './Tabs.js';

type StackProps =
    /**
     * Mint a nested navigator with this route at its base. When set, the
     * `<Stack>` becomes the owner of a new `NavigatorState` and provides
     * `useNav` / `useNavInternals` / `useNavRoutes` to its subtree, so
     * `nav.push('card-route', …)` from inside the stack stays *inside* it
     * (e.g. for per-tab stacks). Routes presented as `modal` / `fullScreen` /
     * `transparent-modal` automatically escalate to the parent navigator
     * via `nav.parent`, walking up until they reach the root — so modals
     * still overlay the whole app.
     *
     * Omit to render the *enclosing* navigator's stack (the default — this
     * is how `<NavigationRoot> → <Stack />` works).
     */
    & Define.Prop<'initialRoute', string>
    /** Initial params for the nested-stack base entry. */
    & Define.Prop<'initialParams', Record<string, unknown>>
    /** Initial search for the nested-stack base entry. */
    & Define.Prop<'initialSearch', Record<string, unknown>>;

let _nestedKeyCounter = 0;

/**
 * Stack navigator — renders the topmost stack entry's component at rest, or
 * the top + underneath entries during a transition.
 *
 * Two modes:
 *
 * **Bound** (no `initialRoute`): renders the enclosing navigator's stack.
 * This is the shape used directly under `<NavigationRoot>` and is what
 * single-stack apps want.
 *
 * **Nested-owner** (`initialRoute="…"`): mints a fresh `NavigatorState` with
 * its own progress `SharedValue` and edge-back gesture, and provides
 * `useNav` / `useNavInternals` / `useNavRoutes` to its subtree. `useNav()`
 * inside this stack returns the nested nav; `nav.parent` points to the
 * enclosing one. Per-tab stacks are the canonical use case:
 *
 * ```tsx
 * <Tabs initialTab="trips">
 *   <Tabs.Screen name="trips"><Stack initialRoute="tripsHome" /></Tabs.Screen>
 *   <Tabs.Screen name="map"><Stack initialRoute="mapHome" /></Tabs.Screen>
 * </Tabs>
 * ```
 *
 * Modal/fullScreen pushes escalate up the parent chain automatically — so
 * `nav.push('newTrip')` from inside Trips (where `newTrip` is `modal`)
 * walks to root and overlays the whole UI. `replace` stays strictly local
 * (asymmetric with `push`) so a modal `replace` never wipes the root stack.
 *
 * **Render strategy** (same in both modes):
 *  - **Idle**: just the top entry, full-bleed, no transform. The screen
 *    component mounts directly so it can use its own layout (no extra
 *    absolute positioning that would break percentage heights).
 *  - **Transitioning**: two `<ScreenContainer>` instances stacked
 *    absolutely, each with an MT-driven `translateX` that reads from the
 *    navigator's progress `SharedValue`. The host's BG thread doesn't tick
 *    per frame — `useAnimatedStyle` runs the interpolation entirely on MT.
 *
 * `key={top.key}` keeps the idle render's component instance stable across
 * unrelated re-renders. During transitions, composite keys
 * (`${entry.key}-${role}-${kind}`) ensure a fresh mount per role/kind pair
 * so the `useAnimatedStyle` binding is set with the right input/output
 * ranges.
 */
export const Stack = component<StackProps>(({ props }) => {
    // Capture enclosing scope's nav + routes + internals BEFORE any of the
    // defineProvide calls below override them for descendants. These are
    // always the "outer" values regardless of whether this Stack is bound
    // or nested-owner.
    const parentNav = useNav();
    const routes = useNavRoutes();
    const parentInternals = useNavInternals();

    // Decide mode at setup. `props.initialRoute` is captured once — the
    // alternative (reactive switch between bound and nested-owner) would
    // need to dispose and recreate the inner nav, which would lose all
    // pushed state. Reasonable to pin it.
    const initialName = props.initialRoute;
    const isNested = typeof initialName === 'string' && initialName.length > 0;

    let nav: Nav;
    let internals: NavInternals;

    if (isNested) {
        if (!routes[initialName]) {
            throw new Error(
                `[lynx-navigation] <Stack initialRoute='${initialName}'>: ` +
                    `route is not registered. Known routes: ` +
                    `${Object.keys(routes).join(', ') || '(none)'}`,
            );
        }

        // Host entry — the parent's current top *when this Stack mounts*.
        // Used by the focus chain so the nested nav is only "locally
        // focused" while its host entry is still the top of the parent.
        // Wrapped in try/catch because `<Stack initialRoute>` *may* be
        // placed outside an EntryScope (e.g. directly under
        // `<NavigationRoot>`); in that case there's no host-entry gate to
        // apply and we just rely on `parent.isLocallyFocused`.
        let hostEntryKey: string | null = null;
        try {
            hostEntryKey = useCurrentEntry().key;
        } catch {
            hostEntryKey = null;
        }

        // Enclosing tab name (if any). Lets the focus chain gate on tab
        // active state — Trips' inner stack reports `isLocallyFocused: false`
        // while the user is on the Map tab, even though it's the top of
        // its own stack.
        let tabName: string | null = null;
        let tabsHandle: ReturnType<typeof useTabs> | null = null;
        try {
            tabName = useTabScreenName();
            tabsHandle = useTabs();
        } catch {
            tabName = null;
            tabsHandle = null;
        }

        // Inherit animation enablement from the parent — if the root was
        // created with `animated={false}` (tests), nested stacks should
        // also commit instantly so test assertions don't have to wait on
        // a SharedValue that won't tick.
        const animationsEnabled = parentInternals.progress !== null;
        const progressSv = useSharedValue(0);

        const presentation =
            (routes[initialName].presentation ?? 'card') as Presentation;
        // Counter-derived suffix keeps base-entry keys unique across
        // concurrent nested stacks in a tab app. Plain `Math.random` would
        // do but a counter is deterministic for test snapshots.
        _nestedKeyCounter += 1;
        const initial: StackEntry = {
            key: `nested-${initialName}-${_nestedKeyCounter}`,
            route: initialName,
            params: props.initialParams ?? {},
            search: props.initialSearch ?? {},
            state: undefined,
            presentation,
        };

        const navState = createNavigatorState({
            routes,
            initial,
            progress: animationsEnabled ? progressSv : undefined,
            parent: parentNav,
            // Start un-focused; the effect below flips this once we observe
            // the parent's current entry / tab-active state.
            initialLocallyFocused: false,
        });

        nav = navState.nav;
        internals = {
            progress: animationsEnabled ? progressSv : null,
            beginBackGesture: navState._gesture.beginBackGesture,
            commitBackGesture: navState._gesture.commitBackGesture,
            cancelBackGesture: navState._gesture.cancelBackGesture,
            edgeSwipeEnabled:
                // Gate on animationsEnabled too — if there's no progress
                // SharedValue (e.g. parent is `animated={false}`), the edge
                // swipe gesture would call `beginBackGesture()` with a null
                // progress and leave the stack in an inconsistent state.
                animationsEnabled && parentInternals.edgeSwipeEnabled,
            screens: navState._screens,
        };

        // Reactive focus chain: this nav is locally focused iff
        //   1. (no host entry captured) OR parent.current.key === hostEntryKey
        //   2. parent.isLocallyFocused
        //   3. (no enclosing tab) OR tabs.active === tabName
        // Effect re-runs on any of those changing — parent's stack
        // mutating, parent's own focus flipping, or the tab switching.
        const focusRunner = effect(() => {
            const hostMatch =
                hostEntryKey === null || parentNav.current.key === hostEntryKey;
            const parentFocused = parentNav.isLocallyFocused;
            const tabActive =
                tabName === null || tabsHandle === null
                    ? true
                    : tabsHandle.active === tabName;
            const focused = hostMatch && parentFocused && tabActive;
            // Write outside the read-tracking window — `_setLocallyFocused`
            // bumps a signal that no consumer in *this* setup reads, but
            // it's good hygiene anyway.
            untrack(() => navState._setLocallyFocused(focused));
        });

        onUnmounted(() => {
            focusRunner.stop();
            parentNav._children.delete(nav);
        });

        defineProvide(useNav, () => nav);
        defineProvide(useNavRoutes, () => routes);
        defineProvide(useNavInternals, () => internals);
    } else {
        nav = parentNav;
        internals = parentInternals;
    }

    return () => {
        const transition = nav.transition;
        const top = nav.current;

        if (!transition) {
            const route = routes[top.route];
            if (!route) return null;
            const Comp = route.component as unknown as ComponentFactory<
                Record<string, unknown>,
                unknown,
                unknown
            >;
            if (typeof Comp !== 'function') return null;
            const params = top.params as Record<string, unknown>;
            // Wrap lazy routes that declare a `fallback` in <Suspense> so the
            // chunk-load shows the user-provided spinner instead of throwing
            // up to the nearest outer boundary (which may be wrong layer or
            // missing entirely).
            const body = isLazyComponent(Comp) && route.fallback
                ? (
                    <Suspense fallback={route.fallback as never}>
                        <Comp {...params} />
                    </Suspense>
                )
                : <Comp {...params} />;
            // When canGoBack and edge-swipe is enabled, overlay the gesture
            // handle so the user can pan from the left edge to start a back
            // transition. `position: absolute` doesn't disturb the screen's
            // own layout — the handle only intercepts touches in the leftmost
            // 20px, and only when they pan rightward past `MIN_DISTANCE`.
            if (nav.canGoBack && internals.edgeSwipeEnabled) {
                return (
                    <view
                        style={{
                            position: 'relative',
                            width: '100%',
                            height: '100%',
                        }}
                    >
                        <EntryScope key={top.key} entry={top}>
                            {body}
                        </EntryScope>
                        <EdgeBackHandle key="edge-back" />
                    </view>
                );
            }
            return (
                <EntryScope key={top.key} entry={top}>
                    {body}
                </EntryScope>
            );
        }

        // Cast progress: TransitionState carries it as `unknown` to avoid
        // pinning the contract to `@sigx/lynx`'s SharedValue at the type
        // level; here at the runtime boundary we know it's a SharedValue<number>.
        const progress = transition.progress as SharedValue<number>;

        return (
            <view
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                }}
            >
                <ScreenContainer
                    key={`${transition.underneathEntry.key}-underneath-${transition.kind}`}
                    entry={transition.underneathEntry}
                    routes={routes}
                    role="underneath"
                    kind={transition.kind}
                    progress={progress}
                />
                <ScreenContainer
                    key={`${transition.topEntry.key}-top-${transition.kind}`}
                    entry={transition.topEntry}
                    routes={routes}
                    role="top"
                    kind={transition.kind}
                    progress={progress}
                />
            </view>
        );
    };
});
