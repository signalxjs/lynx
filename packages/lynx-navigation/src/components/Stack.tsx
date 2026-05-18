import {
    component,
    defineProvide,
    effect,
    onUnmounted,
    untrack,
    useSharedValue,
    type Define,
} from '@sigx/lynx';
import { createNavigatorState } from '../navigator/core.js';
import { useNav, type Nav } from '../hooks/use-nav.js';
import {
    useCurrentEntry,
    useNavInternals,
    useNavRoutes,
    type NavInternals,
} from '../hooks/use-nav-internal.js';
import type { Presentation, StackEntry } from '../types.js';
import { animationVariant, computeLayers } from '../internal/layer-plan.js';
import { EdgeBackHandle } from './EdgeBackHandle.js';
import { Layer } from './Layer.js';
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
 * **Render strategy.** Stack always emits the same JSX shape — a
 * relative wrapper containing one `<Layer>` per entry returned by
 * `computeLayers(stack, transition, progress)`. Each Layer is an
 * absolutely-positioned host view with optional MT-bound translate
 * animation. The pure layer-plan function decides:
 *
 *  - **Idle.** Topmost non-overlay base + any overlays above it. All
 *    static (no transform). Overlays (`modal` / `fullScreen` /
 *    `transparent-modal`) keep their underneath mounted; cards
 *    replace their underneath in the base layer.
 *  - **Card transition.** Both top and underneath animate (slide-in
 *    + parallax). After settle, idle rules apply — the underneath
 *    unmounts because the new top is the sole base.
 *  - **Overlay transition.** The full idle layer stack up through
 *    the underneath stays static; only the animated top has a
 *    transform. After settle, the overlay either joins the static
 *    idle stack (push) or unmounts (pop).
 *
 * Layer keys are `layer-${entry.key}-${animationVariant}`. The variant
 * suffix forces a remount when an entry transitions from animated to
 * static (or vice versa) — `useAnimatedStyle` binds once at setup and
 * can't switch its mapper at runtime. Modal underneath layers never
 * animate, so their key is stable across the modal lifecycle and the
 * subtree's state (per-tab Stack navigators, scroll positions,
 * in-flight inputs) survives.
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

    // Per-stack chrome (slots.default) renders *inside* this Stack's
    // nav scope so a `<Header />` placed there resolves `useNav()` to
    // the per-stack nav. Wrapping the active body in a flex-column
    // with the slot above does that without disturbing layer-fill
    // semantics — the slot takes natural height, the body keeps
    // flex-fill.
    const flexColumnFill = {
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
    } as const;

    return () => {
        const chrome = slots.default?.();
        const layers = computeLayers(nav.stack, nav.transition, internals.progress);

        const renderLayerNode = (layer: typeof layers[number]) => (
            <Layer
                key={`layer-${layer.entry.key}-${animationVariant(layer.animation)}`}
                entry={layer.entry}
                routes={routes}
                animation={layer.animation}
            />
        );
        // Emit the base layer as a SEPARATE child slot, with overlays
        // as an array child slot after it. sigx's reconciler treats a
        // single array-valued JSX child as one "slot" — when the array
        // length changes between renders, keyed children inside can be
        // remounted. Splitting the base out of the array preserves it
        // structurally across modal pushes/pops.
        const baseLayer = layers.length > 0 ? renderLayerNode(layers[0]) : null;
        const overlayLayers = layers.slice(1).map(renderLayerNode);

        // Edge-swipe handle on top — only when the top entry can pop
        // and the swipe is enabled. The handle only intercepts touches
        // in the leftmost 20px and ignores small drags, so placing it
        // last (highest z) doesn't disturb screen touches.
        const edgeHandle = nav.canGoBack && internals.edgeSwipeEnabled
            ? <EdgeBackHandle key="edge-back" />
            : null;

        const body = (
            <view
                style={{
                    position: 'relative',
                    width: '100%',
                    // Flex-fill so the layer container has a real
                    // height — `<Layer>`s anchor via `position:
                    // absolute; top/right/bottom/left: 0`, which
                    // needs a sized relative parent.
                    ...flexColumnFill,
                    // Clip any animated layer that translates off-
                    // screen so the slide doesn't bleed past the
                    // Stack's bounds.
                    overflow: 'hidden',
                }}
            >
                {baseLayer}
                {overlayLayers}
                {edgeHandle}
            </view>
        );

        if (chrome == null) return body as never;
        return (
            <view style={flexColumnFill}>
                {chrome}
                <view style={flexColumnFill}>{body}</view>
            </view>
        );
    };
});
