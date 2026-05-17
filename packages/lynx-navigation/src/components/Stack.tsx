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
    & Define.Prop<'initialSearch', Record<string, unknown>>
    /**
     * Optional chrome rendered *above* the active screen, **inside this
     * Stack's nav scope**. The intended use is `<Header />`, which needs
     * to resolve `useNav()` to the per-stack nav (not the enclosing one)
     * so it can react to pushes inside this stack — e.g. show a back
     * button when a card is pushed onto a per-tab stack.
     *
     * Without this, a `<Header />` placed as a sibling of `<Stack>`
     * would see the enclosing nav and never update when pushes happen
     * inside the nested stack.
     */
    & Define.Slot<'default'>;

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
export const Stack = component<StackProps>(({ props, slots }) => {
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

    // Per-stack chrome (slots.default) needs to render *inside* this
    // Stack's nav scope so a `<Header />` placed there resolves
    // `useNav()` to the per-stack nav. Wrapping the active body in a
    // flex-column with the slot above does that without disturbing the
    // existing fill semantics — the slot takes its natural height, the
    // body keeps its flex-fill.
    const flexColumnFill = {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
    } as const;

    /** Materialize a route component for a given entry. Lazy routes with a
     * `fallback` are wrapped in Suspense. Returns `null` when the route is
     * unknown or its component isn't callable. */
    const renderEntryBody = (entry: StackEntry): unknown => {
        const route = routes[entry.route];
        if (!route) return null;
        const Comp = route.component as unknown as ComponentFactory<
            Record<string, unknown>,
            unknown,
            unknown
        >;
        if (typeof Comp !== 'function') return null;
        const params = entry.params as Record<string, unknown>;
        return isLazyComponent(Comp) && route.fallback
            ? (
                <Suspense fallback={route.fallback as never}>
                    <Comp {...params} />
                </Suspense>
            )
            : <Comp {...params} />;
    };

    const isOverlayPresentation = (p: Presentation): boolean =>
        p === 'modal' || p === 'fullScreen' || p === 'transparent-modal';

    /** Layer style — absolute fill inside a relative parent. Flex-column
     * so descendants that flex-fill (SafeAreaView, daisyui screens) get a
     * sized parent. */
    const layerStyle = {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
    } as const;

    return () => {
        const chrome = slots.default?.();
        const transition = nav.transition;
        const top = nav.current;

        let body: unknown;
        if (!transition) {
            // The screens to render right now: the topmost non-overlay
            // entry as the "base layer", plus any overlay entries
            // (modal / fullScreen / transparent-modal) above it as
            // stacked layers. Overlays don't replace the base — they
            // keep it mounted so its state (per-tab stacks, scroll
            // positions, in-flight inputs) survives modal lifecycle.
            // Card pushes still replace the base (the user expects
            // "back" to recreate the previous screen from history).
            //
            // Crucially, we *always* emit the same JSX shape — a
            // relative wrapper with one or more absolute layers — so
            // the reconciler preserves the base EntryScope across modal
            // pushes/pops. Switching between "bare EntryScope" and
            // "wrapper + layer" remounts the base, which destroys
            // per-tab Stack state.
            const stack = nav.stack;
            let baseIdx = stack.length - 1;
            while (baseIdx > 0 && isOverlayPresentation(stack[baseIdx].presentation)) {
                baseIdx -= 1;
            }
            const baseEntry = stack[baseIdx];
            const overlayEntries = stack.slice(baseIdx + 1);

            const baseScreen = renderEntryBody(baseEntry);
            if (baseScreen === null) return null;

            const baseLayer = (
                <view key={`layer-${baseEntry.key}`} style={layerStyle}>
                    <EntryScope key={baseEntry.key} entry={baseEntry}>
                        {baseScreen}
                    </EntryScope>
                </view>
            );

            const overlayLayers = overlayEntries.map((entry) => {
                const screen = renderEntryBody(entry);
                if (screen === null) return null;
                return (
                    <view key={`layer-${entry.key}`} style={layerStyle}>
                        <EntryScope key={entry.key} entry={entry}>
                            {screen}
                        </EntryScope>
                    </view>
                );
            });

            // Edge-swipe handle on top — only when the top entry can pop
            // and the swipe is enabled. The handle only intercepts
            // touches in the leftmost 20px and ignores small drags, so
            // placing it last (highest z) doesn't disturb screen touches.
            const edgeHandle = (top === baseEntry && nav.canGoBack && internals.edgeSwipeEnabled)
                ? <EdgeBackHandle key="edge-back" />
                : null;

            body = (
                <view
                    style={{
                        position: 'relative',
                        width: '100%',
                        ...flexColumnFill,
                    }}
                >
                    {baseLayer}
                    {overlayLayers}
                    {edgeHandle}
                </view>
            );
        } else {
            // Cast progress: TransitionState carries it as `unknown` to
            // avoid pinning the contract to `@sigx/lynx`'s SharedValue at
            // the type level; here at the runtime boundary we know it's a
            // SharedValue<number>.
            const progress = transition.progress as SharedValue<number>;
            body = (
                <view
                    style={{
                        position: 'relative',
                        width: '100%',
                        // Flex-fill so the transition container actually has
                        // the parent's available height — `<ScreenContainer>`s
                        // anchor via `position: absolute; top/right/bottom/left: 0`,
                        // which needs a relative parent with a real size.
                        ...flexColumnFill,
                        overflow: 'hidden',
                    }}
                >
                    <ScreenContainer
                        key={`${transition.underneathEntry.key}-underneath-${transition.kind}-${transition.topEntry.presentation}`}
                        entry={transition.underneathEntry}
                        routes={routes}
                        role="underneath"
                        kind={transition.kind}
                        presentation={transition.topEntry.presentation}
                        progress={progress}
                    />
                    <ScreenContainer
                        key={`${transition.topEntry.key}-top-${transition.kind}-${transition.topEntry.presentation}`}
                        entry={transition.topEntry}
                        routes={routes}
                        role="top"
                        kind={transition.kind}
                        presentation={transition.topEntry.presentation}
                        progress={progress}
                    />
                </view>
            );
        }

        if (chrome == null) return body as never;
        return (
            <view style={flexColumnFill}>
                {chrome}
                <view style={flexColumnFill}>{body}</view>
            </view>
        );
    };
});
