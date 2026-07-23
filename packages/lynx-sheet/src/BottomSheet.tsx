/**
 * `<BottomSheet>` — THE bottom sheet: a bottom-anchored panel whose
 * visible height snaps between detents, follows the finger when dragged,
 * rides above the keyboard, and (optionally) dims what's behind it and
 * drag-dismisses. No route required — place it in your own layout.
 *
 * Successor to lynx-navigation's inline `<BottomSheet>` with the route
 * sheet's modal features folded in; built on this package's shared
 * engine/pan/backdrop (`engine.ts`, `drag.ts`, `Backdrop.tsx`).
 *
 * ## How it grows without a layout reflow
 * The panel is a fixed-height container (as tall as the top detent)
 * anchored at the bottom; a `translateY` (a TRANSFORM, safe to drive from
 * the main thread every frame — unlike `height`) slides it down so only
 * the bottom `reveal` px show. Content is laid out top-aligned once and
 * rides up as the sheet grows — put the part that should stay pinned to
 * the visible top (e.g. a text input) FIRST.
 *
 * ## Detents
 * `detents` are `DetentSpec`s (px, `{fraction}`, `{keyboard}`) resolved
 * live against screen height, safe-area insets, the remembered keyboard
 * height, and `topOffset` — see `resolveDetents`. The lowest resolved
 * detent is the floor. Geometry is re-resolved every render, never
 * snapshotted (#743): a composer floor that grows an attachment row
 * re-seats the parked sheet automatically.
 *
 * ## Modes
 * - Persistent (default): the sheet never goes below its floor — a
 *   composer accessory. `open` toggles floor ↔ `openDetentIndex`.
 * - `dismissible`: releases projecting below half the floor settle at
 *   reveal 0 and emit `dismiss`; the CONSUMER then flips `open`/unmounts.
 *   `open: false` parks at 0 (hidden) instead of the floor. Combine with
 *   `backdrop` for the modal tray the route sheet used to be needed for.
 *
 * ## Drag modes (mount-constant)
 * - `'handle'` (default): the pan attaches to the `handle` slot only — a
 *   raw `<list>` body keeps scrolling untouched (`lynx-list` does not
 *   adopt the ScrollDragHost protocol yet).
 * - `'surface'`: the whole panel drags, arbitrating against an adopted
 *   inner `@sigx/lynx` `<ScrollView>` (this component provides the
 *   ScrollDragHost) — iOS-style: drag collapses the sheet until it's at
 *   max, then content scrolls, with the one-way handoff back.
 * - `'grabber'`: only the top chrome strip drags; body never does.
 * - `'none'`: no gesture.
 *
 * ## Backdrop & stacking
 * Lynx has no z-index/portal — stacking is document order. The backdrop
 * dims this component's positioned ancestor, so for a full-screen dim
 * render the sheet as the LAST child of a full-surface positioned
 * container. While the sheet is parked at its floor (or dismissed) the
 * backdrop is `display: none` and intercepts nothing.
 */
import {
    component,
    defineProvide,
    effect,
    Platform,
    signal,
    untrack,
    useAnimatedStyle,
    useCreateScrollDragHost,
    useGestureDetector,
    useMainThreadRef,
    useScrollDragHost,
    type Define,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';
import { useKeyboardLift } from '@sigx/lynx-keyboard';
import { useSafeAreaInsets } from '@sigx/lynx-safe-area';
import { Backdrop } from './Backdrop.js';
import { resolveDetents, type DetentSpec } from './detents.js';
import { createSheetPan, RELEASE_DISMISS } from './drag.js';
import { SNAP_MS, useSheetEngine, type SheetGeometry } from './engine.js';
import { GRABBER_HEIGHT } from './math.js';

export interface BackdropOptions {
    /** Fully-open dim opacity. Default 0.4. */
    maxOpacity?: number;
    /** Tap on the dim dismisses (dismissible sheets only). Default true. */
    pressToDismiss?: boolean;
}

export type BottomSheetDragMode = 'surface' | 'handle' | 'grabber' | 'none';

export type BottomSheetProps =
    /** Resting heights — see `DetentSpec`. Lowest resolved detent = floor. */
    & Define.Prop<'detents', readonly DetentSpec[], true>
    /** Open ⇒ move to `openDetentIndex`; closed ⇒ floor (or 0 when dismissible). */
    & Define.Prop<'open', boolean, false>
    /**
     * Animate the `open`/close move. Default `false` — JUMP instantly, so
     * some *other* motion (e.g. a soft keyboard sliding away) reveals the
     * already-painted sheet and the sheet animates nothing (the WhatsApp
     * dip-free reveal). User drags always animate their release snap.
     */
    & Define.Prop<'animate', boolean, false>
    /** Which detent `open` targets. Default: index 1 when there is more than one, else 0. */
    & Define.Prop<'openDetentIndex', number, false>
    /**
     * On open, snap to the CURRENT lifted position (`max(reveal, floor +
     * liftSV)`) instead of the `openDetentIndex` detent — the live keyboard
     * height is captured on the main thread the instant it opens, so when
     * the keyboard's lift animates to 0 the content does NOT move. The
     * captured value also becomes the low snap target for drags. Requires
     * `liftSV`; no-op otherwise.
     */
    & Define.Prop<'openToLift', boolean, false>
    /** Gate the drag gesture (e.g. false while the keyboard owns the space). Default true. */
    & Define.Prop<'dragEnabled', boolean, false>
    /**
     * External lift (px) under the collapsed reveal — pass a keyboard lift
     * SharedValue (`useKeyboardLiftSV()`) so the sheet rides above the
     * keyboard. Effective reveal is `max(reveal, floor + liftSV)`. Note: a
     * sheet cannot visually dismiss under an open keyboard (the lift wins
     * the max) — dismissible overlay sheets shouldn't pass this.
     */
    & Define.Prop<'liftSV', SharedValue<number>, false>
    /**
     * Drag-to-dismiss: a release projecting below half the floor settles
     * at reveal 0 and emits `dismiss`. The sheet only PARKS — the consumer
     * flips `open`/unmounts it. Default false (persistent floor).
     */
    & Define.Prop<'dismissible', boolean, false>
    /** Dim behind the sheet — `true` or per-option object. Default off. */
    & Define.Prop<'backdrop', boolean | BackdropOptions, false>
    /** Gesture attachment shape — MOUNT-CONSTANT (worklets register at setup). */
    & Define.Prop<'dragMode', BottomSheetDragMode, false>
    /**
     * Px reserved above the fully-open sheet (top inset + a header it must
     * never slide under). Caps every resolved detent.
     */
    & Define.Prop<'topOffset', number, false>
    /**
     * Px the sheet's BOTTOM edge sits above the true screen bottom — e.g.
     * `insets.bottom` when an ancestor `<SafeAreaView edges={['bottom']}>`
     * pads the gesture bar. The sheet's top is `bottomEdge - reveal`, so
     * without this the `topOffset` cap is measured from the wrong anchor
     * and the fully-open sheet slides under the header by exactly this
     * amount. Also anchors the surface-drag grabber-zone geometry.
     */
    & Define.Prop<'bottomOffset', number, false>
    /** Receives the combined reveal SharedValue once, at setup (bind siblings to it). */
    & Define.Prop<'onReveal', (sv: SharedValue<number>) => void, false>
    /**
     * Fires on the BG thread when a drag settles. The payload indexes the
     * snap CANDIDATES — the resolved detents normally, `[floor, rest, top]`
     * under `openToLift` — so index 0 = floor and the last index = top in
     * both cases. Only the latest release emits (superseded settles bail).
     */
    & Define.Event<'snap', number>
    /** The sheet settled dismissed (drag or backdrop tap). Consumer closes it. */
    & Define.Event<'dismiss', void>
    /** Any tap on the enabled backdrop (fires whether or not it dismisses). */
    & Define.Event<'backdropTap', void>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    /** Sheet body — laid out top-aligned in the fixed-height box. */
    & Define.Slot<'default'>
    /** Drag-handle region (a pill, a whole input row); rendered above `default`. */
    & Define.Slot<'handle'>;

/** Logical screen height (dp) — Platform reads `lynx.SystemInfo` at load. */
function screenHeightDp(): number {
    const px = Platform.pixelHeight;
    if (px > 0) return Math.round(px / (Platform.pixelRatio || 1));
    return 800; // test env / SSR / non-Lynx host
}

export const BottomSheet = component<BottomSheetProps>(({ props, emit, slots }) => {
    const insets = useSafeAreaInsets();
    const kbLiftBG = useKeyboardLift();
    // Remembered keyboard height for `{keyboard}` detents — tracked from
    // the BG-REACTIVE computed, never from a lift SV's `.value` (that SV
    // is MT-written; its BG side stays at its seed forever).
    let rememberedKb = 0;
    const screenH = screenHeightDp();

    // Live geometry — re-resolved on every render/accessor evaluation,
    // never snapshotted at setup (#743): floors change at runtime.
    const geometry = (): SheetGeometry => {
        const kb = kbLiftBG.value;
        if (kb > rememberedKb) rememberedKb = kb;
        const ds = resolveDetents(props.detents, {
            screenH,
            topOffset: props.topOffset ?? 0,
            bottomOffset: props.bottomOffset ?? 0,
            bottomInset: insets.value.bottom ?? 0,
            keyboardPx: rememberedKb,
        });
        const f = ds[0] ?? 0;
        const i = props.openDetentIndex ?? (ds.length > 1 ? 1 : 0);
        return { floor: f, open: ds[i] ?? f, top: ds[ds.length - 1] ?? f, detents: ds };
    };
    const seed = geometry();

    const engine = useSheetEngine({
        geometry,
        panelHeight: () => geometry().top,
        liftSV: props.liftSV,
        openToLift: props.openToLift === true,
    });
    props.onReveal?.(engine.combined);

    // ---- drag wiring (mount-constant mode: worklets register at setup) --
    const dragMode: BottomSheetDragMode = props.dragMode ?? 'handle';
    const surfaceLike = dragMode === 'surface' || dragMode === 'grabber';
    // Surface modes allocate + provide the ScrollDragHost eagerly (worklet
    // captures are static at register time); an inner `<ScrollView>`
    // mounting later ADOPTS these handles.
    const dragHost = surfaceLike ? useCreateScrollDragHost() : null;
    if (dragHost) defineProvide(useScrollDragHost, () => dragHost);

    const panelRef = useMainThreadRef<MainThread.Element | null>(null);
    const handleRef = useMainThreadRef<MainThread.Element | null>(null);
    useAnimatedStyle(panelRef, () => ({
        sv: engine.translateY,
        mapperName: 'translateY' as const,
        params: { factor: 1 },
    }));

    // ---- BG settle state ------------------------------------------------
    // Claim generation: every grab (and backdrop dismiss) stamps it; a
    // delayed settle compares-and-bails when superseded — the debounce
    // that keeps a quick re-grab from firing a stale snap/dismiss.
    let claimGen = 0;
    const gestureLock = signal(false);
    /** Settled rest reveal (px; BG approximation — `open` detent under openToLift). */
    const restPx = signal(seed.floor);

    const onClaim = (g: number): void => {
        claimGen = g;
        gestureLock.value = true;
    };
    const onRelease = (kind: number, index: number, g: number): void => {
        setTimeout(() => {
            if (claimGen !== g) return; // superseded by a newer grab
            gestureLock.value = false;
            if (kind === RELEASE_DISMISS) {
                restPx.value = 0;
                emit('dismiss');
                return;
            }
            const gg = geometry();
            const cands = engine.openToLift ? [gg.floor, gg.open, gg.top] : gg.detents;
            restPx.value = cands[index] ?? gg.floor;
            emit('snap', index);
        }, SNAP_MS);
    };

    if (dragMode !== 'none') {
        const pan = createSheetPan(engine, {
            surface: surfaceLike,
            grabberOnly: dragMode === 'grabber',
            grabberPx: GRABBER_HEIGHT,
            scrollOffsetY: dragHost?.scrollOffsetY,
            hasVerticalScroll: dragHost?.hasVerticalScroll,
            onClaim,
            onRelease,
        });
        useGestureDetector(dragMode === 'handle' ? handleRef : panelRef, pan);
    }

    if (dragHost) {
        // Compose rest-lock and gesture-lock into the ONE signal the
        // adopted ScrollView reads. Rest-lock applies only when the BODY
        // can drag the sheet ('surface'): below max, a body drag must move
        // the sheet, so content scroll yields. 'grabber' keeps content
        // scrollable at every detent.
        effect(() => {
            const restLock = dragMode === 'surface'
                && props.dragEnabled !== false
                && restPx.value < geometry().top - 0.5;
            dragHost.scrollLock.value = restLock || gestureLock.value;
        });
        // If drag is disabled mid-gesture the pan's onEnd may never run its
        // release — drop the lock so content scroll can't stay frozen.
        effect(() => {
            if (props.dragEnabled === false) {
                untrack(() => {
                    gestureLock.value = false;
                });
            }
        });
    }

    // ---- backdrop -------------------------------------------------------
    const onBackdropPress = (): void => {
        emit('backdropTap');
        const cfg = props.backdrop;
        const pressToDismiss = typeof cfg === 'object' && cfg !== null
            ? cfg.pressToDismiss !== false
            : true;
        if (pressToDismiss && props.dismissible === true) {
            claimGen = Date.now(); // supersede any in-flight release settle
            const g = claimGen;
            void engine.setReveal(0, 1, 0, 0);
            setTimeout(() => {
                if (claimGen !== g) return;
                restPx.value = 0;
                emit('dismiss');
            }, SNAP_MS);
        }
    };

    // ---- render ---------------------------------------------------------
    let lastOpen: boolean | null = null;
    let lastGeom = seed;
    let lastDismissible = -1;
    let lastGate = -1;
    let lastBottomEdge = -1;
    return () => {
        const g = geometry();
        const dismissible = props.dismissible === true ? 1 : 0;
        // A BG-side `sv.value =` write is a read-only no-op, so the drag
        // gate travels the syncGeom push like all worklet-visible flags
        // (#758 — the old inline sheet's render write silently never
        // arrived, freezing dragEnabled at its mount value).
        const gate = props.dragEnabled === false || dragMode === 'none' ? 0 : 1;
        // The sheet's bottom edge in page coords — anchors the surface-drag
        // grabber-zone math on the MT (via syncGeom, same rule as `gate`).
        const bottomEdge = screenH - (props.bottomOffset ?? 0);

        // Push the CURRENT geometry to the worklets, so the drag clamp and
        // release-snap candidates follow a runtime geometry change.
        // lastDismissible/lastGate start at -1 so the first render always
        // pushes (the mount-time gate must land even before any change).
        if (
            dismissible !== lastDismissible
            || gate !== lastGate
            || bottomEdge !== lastBottomEdge
            || g.floor !== lastGeom.floor || g.top !== lastGeom.top
            || g.detents.length !== lastGeom.detents.length
            || g.detents.some((d, i) => d !== lastGeom.detents[i])
        ) {
            const parked = lastOpen !== true;
            const floorMoved = g.floor !== lastGeom.floor;
            lastGeom = g;
            lastDismissible = dismissible;
            lastGate = gate;
            lastBottomEdge = bottomEdge;
            void engine.syncGeom(g.floor, g.top, g.detents, dismissible, gate, bottomEdge);
            // A parked sheet must FOLLOW its floor, or it keeps showing the
            // mount-time slice while its content grows/shrinks underneath.
            // Jump, never animate: the content already changed size this
            // frame. A dismissed sheet (rest 0) stays dismissed.
            if (parked && floorMoved && restPx.value > 0) {
                void engine.setReveal(g.floor, 0, 0, g.open);
                restPx.value = g.floor;
            }
        }

        // React to `open` changes. Closing a dismissible sheet parks it
        // hidden (reveal 0), a persistent one at its floor.
        const open = props.open ?? false;
        if (open !== lastOpen) {
            lastOpen = open;
            const closeTarget = dismissible === 1 ? 0 : g.floor;
            void engine.setReveal(
                open ? g.open : closeTarget,
                props.animate === true ? 1 : 0,
                open && engine.openToLift ? 1 : 0,
                g.open,
            );
            restPx.value = open ? g.open : closeTarget;
        }

        const bd = props.backdrop;
        const backdropOn = bd === true || (typeof bd === 'object' && bd !== null);
        // The dim must intercept nothing while the sheet rests at its
        // floor/dismissed — the content above a persistent sheet stays
        // live. Active while open, mid-gesture, or resting above floor.
        const backdropActive = backdropOn
            && (open || gestureLock.value || restPx.value > g.floor + 0.5);

        return (
            <>
                <Backdrop
                    revealSV={engine.combined}
                    // Persistent sheets show no dim while parked at their
                    // floor, so the fade spans floor→top. A dismissible
                    // sheet hides at reveal 0 and its floor is a REAL
                    // detent (possibly the only one — [floor, top] would
                    // degenerate for a single-detent tray), so the dim
                    // tracks the whole 0→top travel like the route sheet.
                    inputRange={dismissible === 1 ? [0, g.top] : [g.floor, g.top]}
                    maxOpacity={typeof bd === 'object' && bd !== null ? bd.maxOpacity : undefined}
                    enabled={backdropActive}
                    onPress={onBackdropPress}
                />
                <view
                    main-thread:ref={panelRef}
                    class={props.class}
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: `${g.top}px`,
                        display: 'flex',
                        flexDirection: 'column',
                        ...props.style,
                    }}
                >
                    <view main-thread:ref={handleRef}>
                        {slots.handle?.()}
                    </view>
                    {/* Body fills the rest of the fixed-height panel, giving a
                        bounded height to content that measures itself (e.g. a
                        virtualized grid gating on a non-zero region). */}
                    <view style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                        {slots.default?.()}
                    </view>
                </view>
            </>
        );
    };
});
