import {
    component,
    Gesture,
    onUnmounted,
    runOnBackground,
    runOnMainThread,
    useAnimatedStyle,
    useDerivedValue,
    useGestureDetector,
    useMainThreadRef,
    useSharedValue,
    type Define,
    type MainThread,
    type SharedValue,
} from '@sigx/lynx';
import { cancelAnimation, withTiming } from '@sigx/lynx-motion';

/**
 * `<BottomSheet>` — an **inline, persistent** bottom sheet: a bottom-anchored
 * panel whose visible height snaps between `detents` and follows the finger
 * when dragged. Unlike a `presentation:'sheet'` ROUTE (a full-screen modal
 * overlay with a backdrop that blocks the screen behind it), this is a plain
 * child you place at the bottom of your own layout — no route, no scrim, and
 * the content above it stays live and tappable. Use it for a resizable
 * composer accessory (input + emoji panel) or any drag-to-expand tray.
 *
 * ## How it grows without a layout reflow
 * The panel is a fixed `maxHeight`-tall container anchored at the bottom; a
 * `translateY` (a TRANSFORM, safe to drive from the main thread every frame —
 * unlike `height`, whose per-frame layout writes don't reflow) slides it down
 * so only the bottom `reveal` px show. Dragging changes `reveal`; the content,
 * laid out top-aligned once, rides up as the sheet grows. Put the part that
 * should stay pinned to the visible top (e.g. a text input) FIRST in the
 * content.
 *
 * ## Detents & drag
 * `detents` are visible-height values in px, ascending; `detents[0]` is the
 * collapsed floor (the sheet never goes below it — it's persistent, it does
 * not dismiss). `open` toggles between `detents[0]` (closed) and
 * `openDetentIndex` (default the second detent) with an animation. Dragging
 * the handle region moves `reveal` 1:1 with the finger and snaps to the
 * nearest detent on release. `dragEnabled={false}` freezes it (e.g. while a
 * keyboard owns the space and there's nothing to drag).
 *
 * ## Lift
 * Pass `liftSV` (e.g. a keyboard lift height) — the sheet's effective reveal
 * is `max(reveal, collapsedReveal + liftSV)`, so when a keyboard opens the
 * panel rides up to sit above it, and the two never fight. `onReveal` hands
 * back the combined reveal SharedValue so a sibling (the content area above)
 * can pad itself by it.
 */
export type BottomSheetProps =
    /** Max content height (px) — the panel is laid out this tall; detents reveal a slice. */
    & Define.Prop<'maxHeight', number, true>
    /** Visible-height detents (px), ascending. `[0]` is the collapsed floor. */
    & Define.Prop<'detents', readonly number[], true>
    /** Open ⇒ move to `openDetentIndex`; closed ⇒ move to `detents[0]`. */
    & Define.Prop<'open', boolean, false>
    /**
     * Animate the `open`/close move. Default `false` — JUMP instantly, so
     * some *other* motion (e.g. a soft keyboard sliding away) reveals the
     * already-painted sheet and the sheet animates nothing (the WhatsApp
     * dip-free reveal). User drags always animate their release snap.
     */
    & Define.Prop<'animate', boolean, false>
    /** Which detent `open` targets. Default: index 1 (the second detent) when there is more than one, else 0. */
    & Define.Prop<'openDetentIndex', number, false>
    /**
     * On open, snap to the CURRENT lifted position (`max(reveal, floor +
     * liftSV)`) instead of the `openDetentIndex` detent — clamped to at least
     * that detent and at most the top. Use with `liftSV` so the open rest
     * position exactly matches where the sheet sat while the keyboard was up:
     * the live keyboard height is captured on the main thread the instant it
     * opens, so when the keyboard's lift then animates to 0 the content does
     * NOT move (a BG-computed detent can't equal the live MT lift, hence the
     * jump this avoids). The captured value also becomes the low snap target
     * for drags. Requires `liftSV`; no-op otherwise.
     */
    & Define.Prop<'openToLift', boolean, false>
    /** Gate the drag gesture (e.g. false while the keyboard owns the space). Default true. */
    & Define.Prop<'dragEnabled', boolean, false>
    /**
     * External lift (px) added under the collapsed reveal — pass a keyboard
     * lift SharedValue so the sheet rides above the keyboard. The effective
     * reveal is `max(reveal, detents[0] + liftSV)`.
     */
    & Define.Prop<'liftSV', SharedValue<number>, false>
    /** Receives the combined reveal SharedValue once, at setup (bind siblings to it). */
    & Define.Prop<'onReveal', (sv: SharedValue<number>) => void, false>
    /**
     * Fires on the BG thread when a drag settles. The payload indexes the
     * snap CANDIDATES, which are the `detents` normally, but `[floor,
     * capturedLiftRest, top]` under `openToLift` — so index 0 = floor and the
     * last index = top in both cases, but the middle differs. Debounced:
     * only the latest release emits.
     */
    & Define.Event<'snap', number>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    /** Sheet body — laid out top-aligned in the `maxHeight` box. */
    & Define.Slot<'default'>
    /** Drag-handle region (a pill etc.); the pan attaches here. Rendered above `default`. */
    & Define.Slot<'handle'>;

const MIN_DISTANCE = 6;
const SNAP_SEC = 0.2;
const SNAP_MS = Math.round(SNAP_SEC * 1000);
/** Seconds of finger velocity a release projects ahead to pick a detent. */
const PROJECTION_SEC = 0.15;

export const BottomSheet = component<BottomSheetProps>(({ props, emit, slots }) => {
    const maxHeight = props.maxHeight;
    const detents = [...props.detents];
    const floor = detents[0] ?? 0;
    const openIndex = props.openDetentIndex ?? (detents.length > 1 ? 1 : 0);
    const openReveal = detents[openIndex] ?? floor;

    // The drag/animation-owned reveal (px visible above the bottom edge). The
    // pan writes it per frame (auto-flushed, #681); `withTiming` animates it
    // for open/close.
    const reveal = useSharedValue(floor);
    // `dragEnabled` as a SharedValue (1/0) so the pan worklet can actually
    // gate on it — a BG prop isn't readable on the MT. Written from render
    // below; the worklet reads `dragGateSV.current.value`.
    const dragGateSV = useSharedValue(1);
    // Effective reveal also clears an external lift (keyboard): the sheet
    // rides up to sit above whatever occupies the bottom. `scale` folds the
    // lift to `floor + lift`; `max` takes whichever is taller.
    const liftSV = props.liftSV;
    const liftedFloor = liftSV
        ? useDerivedValue([liftSV], 'scale', { factor: 1, offset: floor })
        : null;
    const combined = liftedFloor
        ? useDerivedValue([reveal, liftedFloor], 'max')
        : reveal;
    // translateY = maxHeight - combined  (slide the fixed-height box down so
    // only `combined` px show). A single scale-derived, bound with factor 1.
    const translateY = useDerivedValue([combined], 'scale', { factor: -1, offset: maxHeight });

    props.onReveal?.(combined);

    const panelRef = useMainThreadRef<MainThread.Element | null>(null);
    // The pan attaches to the HANDLE region only (the `handle` slot), not the
    // whole panel — so a raw `<list>` in the body still scrolls (surface-drag
    // over list content is the documented arbitration gap). Drag the handle
    // (a pill, or a whole input row) to resize.
    const handleRef = useMainThreadRef<MainThread.Element | null>(null);
    useAnimatedStyle(panelRef, () => ({ sv: translateY, mapperName: 'translateY', params: { factor: 1 } }));

    // Move to a detent when `open` toggles. `animate={false}` (the default)
    // JUMPS instantly — the sheet is painted at its detent in one frame and
    // some *other* motion (a soft keyboard sliding away) reveals it; the sheet
    // animates nothing itself. Only user drags animate (the release snap).
    // Both `cancelAnimation`/`withTiming` are main-thread calls, so they run
    // through `runOnMainThread` (BG render can't call them).
    const openToLift = props.openToLift === true && liftSV != null;
    // The open REST reveal — either the `openReveal` detent, or (with
    // `openToLift`) the lifted position captured on the MT the instant the
    // sheet opens. Held here so the drag-release snap targets the exact same
    // rest position rather than a BG-computed detent that can't equal it.
    const openRestRef = useMainThreadRef({ rest: openReveal });
    let lastOpen: boolean | null = null;
    // Declared BEFORE the worklets that capture them: a `runOnMainThread`
    // closure captures its referenced lexicals when the expression evaluates,
    // so a `const` declared *after* the worklet is still in its temporal dead
    // zone at capture time → "lexical variable is not initialized" on the BG.
    const detentsArr = [...detents];
    const minReveal = floor;
    const maxReveal = detents[detents.length - 1] ?? floor;
    const setReveal = runOnMainThread((target: number, animate: number, capture: number, openFloor: number) => {
        'main thread';
        cancelAnimation(reveal);
        let t = target;
        if (capture === 1) {
            // Capture the CURRENT lifted position (== the keyboard-mode height,
            // read live on the MT while the keyboard is still up) so that when
            // the keyboard's lift then animates to 0 the content does NOT move.
            // Clamp to at least the fallback detent (no keyboard was up) and at
            // most the top.
            let c = combined.current.value;
            if (c < openFloor) c = openFloor;
            if (c > maxReveal) c = maxReveal;
            t = c;
            openRestRef.current.rest = c;
        }
        if (animate === 1) withTiming(reveal, t, { duration: SNAP_SEC });
        else reveal.current.value = t;
    });

    // Per-drag transient (main-thread ref — worklet-visible mutable state).
    const drag = useMainThreadRef({ startY: 0, startReveal: 0, prevY: 0, prevT: 0, vel: 0, active: 0 });

    // Debounced snap emit (BG): a quick re-grab+release must not let an
    // earlier settle timer still fire a stale index — clear the prior timer
    // each release, so only the latest settle emits. Cleared on unmount.
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSnap = (i: number): void => {
        if (snapTimer !== null) clearTimeout(snapTimer);
        snapTimer = setTimeout(() => { snapTimer = null; emit('snap', i); }, SNAP_MS);
    };
    onUnmounted(() => { if (snapTimer !== null) clearTimeout(snapTimer); });

    const pan = Gesture.Pan()
        .axis('y')
        .minDistance(MIN_DISTANCE)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: { params?: { pageY?: number } }) => {
            'main thread';
            // `dragEnabled={false}` freezes the gesture (mirrored into
            // `dragGateSV` from render) — that's the single gate. Drag is NOT
            // disabled at the floor: a collapsed sheet must be draggable OPEN
            // (the up-clamp in onUpdate keeps it from going below the floor).
            // A consumer that shouldn't drag at the floor (e.g. a composer at
            // keyboard height) sets `dragEnabled={false}` there.
            if (dragGateSV.current.value === 0) { drag.current.active = 0; return; }
            const y = e?.params?.pageY ?? 0;
            drag.current.startY = y;
            drag.current.prevY = y;
            drag.current.prevT = Date.now();
            drag.current.vel = 0;
            drag.current.startReveal = reveal.current.value;
            drag.current.active = 1;
            // Stop any in-flight open/close tween or it fights the finger.
            cancelAnimation(reveal);
        })
        .onUpdate((e: { params?: { pageY?: number } }) => {
            'main thread';
            if (drag.current.active === 0) return;
            const y = e?.params?.pageY ?? 0;
            const now = Date.now();
            const dt = now - drag.current.prevT;
            if (dt > 0) drag.current.vel = ((y - drag.current.prevY) / dt) * 1000;
            drag.current.prevY = y;
            drag.current.prevT = now;
            // Drag UP (dy < 0) grows the sheet: reveal increases.
            const dy = y - drag.current.startY;
            let next = drag.current.startReveal - dy;
            if (next < minReveal) next = minReveal;
            if (next > maxReveal) next = maxReveal;
            reveal.current.value = next;
        })
        .onEnd(() => {
            'main thread';
            if (drag.current.active === 0) return;
            drag.current.active = 0;
            // Project the finger's velocity ahead, then snap to the nearest
            // detent. Velocity is px/sec, positive = downward = shrink.
            const projected = reveal.current.value - drag.current.vel * PROJECTION_SEC;
            // With `openToLift` the low "open rest" is the CAPTURED lifted
            // position (== the keyboard height), not the BG `openReveal`
            // detent — so a release near the compact rest returns to exactly
            // where the keyboard sat. Candidates: floor, captured rest, top.
            const cands = openToLift
                ? [minReveal, openRestRef.current.rest, maxReveal]
                : detentsArr;
            let bestI = 0;
            let bestD = -1;
            for (let i = 0; i < cands.length; i += 1) {
                const d = projected - cands[i];
                const ad = d < 0 ? -d : d;
                if (bestD < 0 || ad < bestD) { bestD = ad; bestI = i; }
            }
            const target = cands[bestI];
            withTiming(reveal, target, { duration: SNAP_SEC });
            runOnBackground(scheduleSnap)(bestI);
        });

    useGestureDetector(handleRef, pan);

    return () => {
        // Mirror `dragEnabled` (default true) into the worklet-readable SV
        // (written on BG with `.value`; the pan worklet reads `.current.value`).
        dragGateSV.value = props.dragEnabled === false ? 0 : 1;
        // React to `open` changes (render closure tracks props.open).
        const open = props.open ?? false;
        if (open !== lastOpen) {
            lastOpen = open;
            void setReveal(
                open ? openReveal : floor,
                props.animate === true ? 1 : 0,
                open && openToLift ? 1 : 0,
                openReveal,
            );
        }
        return (
            <view
                main-thread:ref={panelRef}
                class={props.class}
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: `${maxHeight}px`,
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
        );
    };
});
