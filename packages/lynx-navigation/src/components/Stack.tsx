import {
    component,
    defineProvide,
    effect,
    onUnmounted,
    signal,
    untrack,
    useCreateScrollDragHost,
    useMainThreadRef,
    useScrollDragHost,
    useSharedValue,
    type Define,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';
import { createNavigatorState } from '../navigator/core.js';
import { useNav, type Nav } from '../hooks/use-nav.js';
import {
    useCurrentEntry,
    useNavInternals,
    useNavRoutes,
    type NavInternals,
} from '../hooks/use-nav-internal.js';
import type { Presentation, RouteMap, StackEntry } from '../types.js';
import {
    computeLayers,
    isOverlayPresentation,
    MAX_LAYERS,
    SHEET_BACKDROP_MAX_OPACITY,
    type LayerAnimation,
    type SheetLayerContext,
} from '../internal/layer-plan.js';
import {
    initialSnapProgress,
    progressToOffsetY,
    resolveSnapPoints,
    snapToProgress,
} from '../internal/sheet-math.js';
import { SCREEN_HEIGHT } from '../internal/screen-width.js';
import { EdgeBackHandle } from './EdgeBackHandle.js';
import { Layer } from './Layer.js';
import { SheetBackdrop } from './SheetBackdrop.js';
import { SheetDragController } from './SheetDragController.js';
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
     * Max number of *covered* cards kept mounted-but-hidden beneath the
     * visible top (card-stack screen retention). Covered cards stay
     * mounted so back-navigation reveals them instantly with state
     * intact, instead of rebuilding. Omit to retain all (bounded only by
     * the renderer's `MAX_LAYERS` slot cap). Set a small number to bound
     * memory — the deepest covered cards beyond the window unmount and
     * rebuild on pop-back. Mirrors React Navigation's
     * `detachInactiveScreens` / `maxRetainedScreens`.
     */
    & Define.Prop<'maxRetainedScreens', number>
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

type SheetSlotProps =
    & Define.Prop<'entry', StackEntry, true>
    & Define.Prop<'routes', RouteMap, true>
    & Define.Prop<'animation', LayerAnimation | null, false>
    & Define.Prop<'hidden', boolean, false>
    & Define.Prop<'staticOffsetY', number, false>
    & Define.Prop<'sheetProgress', SharedValue<number> | null, true>
    & Define.Prop<'staticBackdropOpacity', number, true>
    & Define.Prop<'dismissable', boolean, true>
    /** Mount the full-surface drag controller (top resting sheet, drag on). */
    & Define.Prop<'dragEnabled', boolean, true>
    /** `'surface'` (default) or `'grabber'` — see `ScreenOptions.dragHandle`. */
    & Define.Prop<'dragMode', 'surface' | 'grabber', true>
    /** Snap progress values (ascending) for this sheet's config. */
    & Define.Prop<'snapProgresses', readonly number[], true>
    & Define.Prop<'maxSnapFraction', number, true>
    /** Sheet rests below its max detent → inner content scroll stays locked. */
    & Define.Prop<'restingBelowMax', boolean, true>
    /** BG callback: gesture settled at a (non-dismiss) snap progress. */
    & Define.Prop<'onSettle', (progress: number) => void, true>;

/**
 * One Stack slot hosting a sheet entry: its `<SheetBackdrop>`, the regular
 * `<Layer>`, and the (null-flipping) `<SheetDragController>`. Wrapped in a
 * component (fragment at the component root — the same proven shape as
 * daisyui's ThemeProvider) rather than an inline fragment, because the
 * Stack body's 24 unrolled slots are position-stable single children and
 * an inline multi-child fragment in a slot is exactly the array-shape
 * change the reconciler remounts on (see the slot comment in the render
 * below). Document order inside: backdrop below, sheet surface above —
 * Lynx has no z-index.
 *
 * Every sheet entry routes through this component — visible OR hidden
 * (retained-covered) — so the slot's component type never flips between
 * `<SheetSlot>` and `<Layer>` mid-life, which would remount the screen
 * subtree. The fragment's child shape is constant too (always 3 children):
 * the backdrop hides via `display: none`, and the drag controller slot
 * flips `null ↔ component` (renderless — no view shape change either way).
 *
 * Sheet-drag ownership lives here: the slot owns the Layer's host element
 * ref (so the controller's pan attaches to the sheet surface itself) and
 * eagerly allocates the `ScrollDragHost` it provides to the screen subtree
 * — eager because the controller's worklets can only capture SharedValue
 * identities that exist when the gesture registers; an inner `<ScrollView>`
 * mounting later ADOPTS these handles (see `scroll-drag-host.ts`).
 *
 * The host's `scrollLock` composes two sources into the ONE signal the
 * adopted ScrollView reads: `restingBelowMax` (derived by Stack from the
 * settled detent — content never scrolls while the sheet is partially
 * open) and `gestureLock` (the controller claimed the current drag).
 */
const SheetSlot = component<SheetSlotProps>(({ props }) => {
    const hostRef = useMainThreadRef<MainThread.Element | null>(null);
    const dragHost = useCreateScrollDragHost();
    defineProvide(useScrollDragHost, () => dragHost);

    // Stale-settle guard: MT stamps a generation at claim; delayed BG
    // settle/dismiss timeouts compare against this signal and bail when
    // superseded by a newer grab.
    const genSignal = signal(0);
    const gestureLock = signal(false);
    const lockRunner = effect(() => {
        // Rest-lock applies only when the BODY can drag the sheet
        // ('surface' + drag active): below max, a body drag must move the
        // sheet, so content scroll yields. In 'grabber'/'none' modes the
        // body never drags — content must stay scrollable at every detent
        // (there'd be no gesture path to unlock it otherwise). gestureLock
        // still freezes content during an active sheet-owned drag from the
        // grabber zone.
        const restLock =
            props.restingBelowMax
            && props.dragEnabled
            && props.dragMode === 'surface';
        dragHost.scrollLock.value = restLock || gestureLock.value;
    });
    // If the controller unmounts mid-gesture (a push covers the sheet, a
    // transition starts), its onEnd may never fire — drop the gesture lock
    // whenever drag is disabled so content scroll can't stay frozen.
    const dragDisabledRunner = effect(() => {
        if (!props.dragEnabled) {
            untrack(() => {
                gestureLock.value = false;
            });
        }
    });
    onUnmounted(() => {
        lockRunner.stop();
        dragDisabledRunner.stop();
    });

    return () => (
        <>
            <SheetBackdrop
                sheetProgress={props.sheetProgress}
                staticOpacity={props.staticBackdropOpacity}
                dismissable={props.dismissable ?? false}
                hidden={props.hidden ?? false}
            />
            <Layer
                key={`layer-${props.entry.key}`}
                entry={props.entry}
                routes={props.routes}
                animation={props.animation}
                hidden={props.hidden}
                staticOffsetY={props.staticOffsetY}
                hostRef={hostRef}
            />
            {props.dragEnabled
                ? (
                    <SheetDragController
                        // Keyed by snap signature + mode: the controller
                        // snapshots its config at setup (worklet capture),
                        // so a reactive change must remount it. Entry
                        // identity is already pinned by the slot's own key.
                        key={`drag-${props.snapProgresses.join('_')}-${props.dragMode}`}
                        entryKey={props.entry.key}
                        snapProgresses={props.snapProgresses}
                        maxSnapFraction={props.maxSnapFraction}
                        dragMode={props.dragMode}
                        hostRef={hostRef}
                        dragHost={dragHost}
                        genSignal={genSignal}
                        onGestureLock={(locked: boolean) => {
                            gestureLock.value = locked;
                        }}
                        onSettle={props.onSettle}
                    />
                )
                : null}
        </>
    );
});

/**
 * Number of `renderLayerNode(layers[n])` slots unrolled in the render
 * below. Must equal `MAX_LAYERS` — `computeLayers` trims its output to
 * `MAX_LAYERS`, so any layer beyond this count would be silently
 * dropped. The type-level check fails to compile if the two drift, so
 * raising `MAX_LAYERS` forces you to add matching slots here.
 */
const RENDERED_LAYER_SLOTS = 24;
type _AssertSlotCount = typeof MAX_LAYERS extends typeof RENDERED_LAYER_SLOTS
    ? typeof RENDERED_LAYER_SLOTS extends typeof MAX_LAYERS
        ? true
        : never
    : never;
const _slotCountOk: _AssertSlotCount = true;
void _slotCountOk;

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
 * Layer keys are `layer-${entry.key}` — stable for the entry's whole
 * life. A layer is never remounted just because its animation state
 * changes; instead `<Layer>` drives the *reactive* `useAnimatedStyle`,
 * which re-binds the MT transform on the same element as the entry
 * animates and then settles. So a single push mounts the target screen
 * exactly once (one `onMounted`, one data fetch) and the underneath /
 * modal-underneath subtrees (per-tab Stack navigators, scroll positions,
 * in-flight inputs) survive the whole transition.
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
            // Sheets always escalate to the root navigator, so a nested
            // stack never animates one itself.
            sheetProgress: null,
            beginBackGesture: navState._gesture.beginBackGesture,
            commitBackGesture: navState._gesture.commitBackGesture,
            cancelBackGesture: navState._gesture.cancelBackGesture,
            commitSheetDismiss: navState._gesture.commitSheetDismiss,
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

    // Last gesture-settled snap progress per sheet entry key, written by
    // `<SheetDragController>` on a snap release (one BG hop). Read when a
    // sheet gets covered (something pushed above it) so its static layer
    // keeps the user's chosen detent instead of reverting to the initial
    // snap — and to derive `restingBelowMax` (content scroll stays locked
    // while the sheet rests below its max detent).
    const sheetRestBox = signal<Record<string, number>>({});

    // Prune settled-snap records when their entries leave the stack —
    // entry keys are unique per push, so without this the map grows for
    // every sheet ever opened in the session.
    const sheetPruneRunner = effect(() => {
        const live = new Set(nav.stack.map((e) => e.key));
        untrack(() => {
            for (const key of Object.keys(sheetRestBox)) {
                if (!live.has(key)) delete sheetRestBox[key];
            }
        });
    });
    onUnmounted(() => sheetPruneRunner.stop());

    /** Snap config for a sheet entry from its `<Screen>` registration. */
    const sheetConfigFor = (entry: StackEntry) => {
        const options = internals.screens.get(entry.key)?.options;
        const snaps = resolveSnapPoints(options?.snapPoints);
        return {
            snaps,
            maxFraction: snaps[snaps.length - 1],
            initialSnapIndex: options?.initialSnapIndex,
            backdropDismiss: options?.backdropDismiss !== false,
            dragHandle: options?.dragHandle ?? 'surface',
        };
    };

    /** Resting progress for a sheet: last gesture-settled detent, else initial. */
    const sheetRestProgress = (entry: StackEntry): number => {
        const { snaps, initialSnapIndex } = sheetConfigFor(entry);
        return sheetRestBox[entry.key] ?? initialSnapProgress(snaps, initialSnapIndex);
    };

    /** Resting translateY for a sheet that can't hold an animation binding. */
    const sheetStaticOffsetY = (entry: StackEntry): number => {
        const { maxFraction } = sheetConfigFor(entry);
        return progressToOffsetY(sheetRestProgress(entry), maxFraction, SCREEN_HEIGHT);
    };

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

        // The "active" sheet — the one whose binding rides the dedicated
        // sheet SV: a transitioning sheet top, else a resting top sheet.
        const transitionTop = nav.transition?.topEntry;
        const currentTop = nav.current;
        const activeSheetEntry =
            transitionTop?.presentation === 'sheet'
                ? transitionTop
                : currentTop.presentation === 'sheet'
                    ? currentTop
                    : null;
        // Resolve the sheet context only when some sheet is in play —
        // reading snap options here is reactive, so a late `<Screen
        // snapPoints>` registration (lazy routes) re-renders with the
        // corrected mapper range.
        const hasSheet =
            activeSheetEntry !== null ||
            nav.stack.some((e) => e.presentation === 'sheet');
        const sheetCtx: SheetLayerContext | undefined = hasSheet
            ? {
                sheetProgress: internals.sheetProgress,
                maxSnapFraction: activeSheetEntry
                    ? sheetConfigFor(activeSheetEntry).maxFraction
                    : 1,
                staticOffsetY: sheetStaticOffsetY,
            }
            : undefined;

        const layers = computeLayers(
            nav.stack,
            nav.transition,
            internals.progress,
            props.maxRetainedScreens,
            sheetCtx,
        );

        // A visible sheet entry renders through `<SheetSlot>` — its
        // `<SheetBackdrop>` followed by the regular `<Layer>` — so the
        // backdrop sits above all lower layers and beneath the sheet
        // surface (document order; Lynx has no z-index). The slot stays
        // one position-stable child either way.
        const renderLayerNode = (layer: typeof layers[number] | undefined) => {
            if (!layer) return null;
            if (layer.entry.presentation === 'sheet') {
                const cfg = sheetConfigFor(layer.entry);
                const entryKey = layer.entry.key;
                // Full-surface drag controller mounts for the top *resting*
                // sheet only (never mid-transition), with animations enabled
                // and a real snap config — the same gate the old grabber
                // strip used — unless the screen opted out entirely.
                const dragEnabled =
                    entryKey === activeSheetEntry?.key
                    && entryKey === currentTop.key
                    && !nav.transition
                    && !!internals.sheetProgress
                    && cfg.snaps.length > 0
                    && cfg.dragHandle !== 'none';
                return (
                    <SheetSlot
                        key={`layer-${layer.entry.key}`}
                        entry={layer.entry}
                        routes={routes}
                        animation={layer.animation}
                        hidden={layer.hidden}
                        staticOffsetY={layer.staticOffsetY}
                        sheetProgress={
                            layer.entry.key === activeSheetEntry?.key
                                ? internals.sheetProgress
                                : null
                        }
                        staticBackdropOpacity={
                            sheetRestProgress(layer.entry) * SHEET_BACKDROP_MAX_OPACITY
                        }
                        dismissable={
                            layer.entry.key === currentTop.key &&
                            !nav.transition &&
                            cfg.backdropDismiss
                        }
                        dragEnabled={dragEnabled}
                        dragMode={cfg.dragHandle === 'grabber' ? 'grabber' : 'surface'}
                        snapProgresses={cfg.snaps.map((f) => snapToProgress(f, cfg.maxFraction))}
                        maxSnapFraction={cfg.maxFraction}
                        restingBelowMax={sheetRestProgress(layer.entry) < 1 - 0.001}
                        onSettle={(p: number) => {
                            // The settle callback arrives via a delayed BG
                            // timeout — if the sheet was popped meanwhile,
                            // writing would re-add a key the prune effect
                            // already removed (and nothing would prune it
                            // again until the next stack change).
                            if (nav.stack.some((e) => e.key === entryKey)) {
                                sheetRestBox[entryKey] = p;
                            }
                        }}
                    />
                );
            }
            return (
                <Layer
                    key={`layer-${layer.entry.key}`}
                    entry={layer.entry}
                    routes={routes}
                    animation={layer.animation}
                    hidden={layer.hidden}
                    staticOffsetY={layer.staticOffsetY}
                />
            );
        };
        // sigx's reconciler treats a single array-valued JSX child as
        // one "slot": when the array's *length* changes between
        // renders, keyed children inside can be remounted even if
        // their keys are stable. To make stacked-overlay state
        // preservation work (modal A still mounted after modal B
        // pushes on top), each layer is emitted as its own separate
        // JSX child slot rather than as an array. The slots are
        // position-stable across renders — the only thing that
        // changes is a slot turning from `null` to a Layer (mount) or
        // vice versa (unmount). The slot count MUST equal MAX_LAYERS
        // (the cap `computeLayers` trims to); card retention keeps
        // covered cards mounted, so the slots now also hold a deep
        // card history, not just 2-3 overlays. If you raise MAX_LAYERS,
        // add matching slots below — the unrolled shape is just
        // verbose, not algorithmically limited.

        // Edge-swipe handle on top, gated on:
        //  - `internals.edgeSwipeEnabled` — opt-out flag (also off
        //    when the navigator has no progress SharedValue, i.e.
        //    animations disabled — no in-flight gesture to animate).
        //  - `nav.canGoBack` — something to pop back to.
        //  - `!nav.transition` — no animation already running.
        //  - The current top is a card (not an overlay). Edge-swipe
        //    is the iOS-style horizontal pop gesture for card stacks;
        //    using it to dismiss a modal would be the wrong axis +
        //    the wrong dismissal semantic.
        //
        // The handle only intercepts touches in the leftmost 20px and
        // ignores small drags, so placing it last (highest z) doesn't
        // disturb screen touches.
        const top = nav.current;
        const edgeHandle = (
            internals.edgeSwipeEnabled
            && nav.canGoBack
            && !nav.transition
            && !isOverlayPresentation(top.presentation)
        )
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
                {renderLayerNode(layers[0])}
                {renderLayerNode(layers[1])}
                {renderLayerNode(layers[2])}
                {renderLayerNode(layers[3])}
                {renderLayerNode(layers[4])}
                {renderLayerNode(layers[5])}
                {renderLayerNode(layers[6])}
                {renderLayerNode(layers[7])}
                {renderLayerNode(layers[8])}
                {renderLayerNode(layers[9])}
                {renderLayerNode(layers[10])}
                {renderLayerNode(layers[11])}
                {renderLayerNode(layers[12])}
                {renderLayerNode(layers[13])}
                {renderLayerNode(layers[14])}
                {renderLayerNode(layers[15])}
                {renderLayerNode(layers[16])}
                {renderLayerNode(layers[17])}
                {renderLayerNode(layers[18])}
                {renderLayerNode(layers[19])}
                {renderLayerNode(layers[20])}
                {renderLayerNode(layers[21])}
                {renderLayerNode(layers[22])}
                {renderLayerNode(layers[23])}
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
