import {
    component,
    Gesture,
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
 * the handle region (or, with `dragSurface`, the whole non-scrolling body)
 * moves `reveal` 1:1 with the finger and snaps to the nearest detent on
 * release. `dragEnabled={false}` freezes it (e.g. while a keyboard owns the
 * space and there's nothing to drag).
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
    /** Open ⇒ animate to `openDetentIndex`; closed ⇒ animate to `detents[0]`. */
    & Define.Prop<'open', boolean, false>
    /** Which detent `open` targets. Default: the last detent's *previous* (index 1 if present, else 0). */
    & Define.Prop<'openDetentIndex', number, false>
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
    /** Fires on the BG thread when a drag settles at a detent index. */
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

    // Animate to a detent when `open` toggles. `withTiming` is a main-thread
    // call, so it runs through `runOnMainThread` (BG render can't call it).
    let lastOpen: boolean | null = null;
    const animateReveal = runOnMainThread((target: number) => {
        'main thread';
        cancelAnimation(reveal);
        withTiming(reveal, target, { duration: SNAP_SEC });
    });

    // Per-drag transient (main-thread ref — worklet-visible mutable state).
    const drag = useMainThreadRef({ startY: 0, startReveal: 0, prevY: 0, prevT: 0, vel: 0, active: 0 });

    // Snap targets as a plain array the worklet captures as a literal.
    const detentsArr = [...detents];
    const minReveal = floor;
    const maxReveal = detents[detents.length - 1] ?? floor;

    const pan = Gesture.Pan()
        .axis('y')
        .minDistance(MIN_DISTANCE)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: { params?: { pageY?: number } }) => {
            'main thread';
            // Drag only when the sheet is ABOVE its floor (i.e. open). At the
            // floor (collapsed / keyboard mode) there's nothing to resize —
            // and gating on the reveal position needs no BG→SV write (a
            // SharedValue is read-only on BG), so `dragEnabled` is advisory.
            if (reveal.current.value <= minReveal + 2) { drag.current.active = 0; return; }
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
            let bestI = 0;
            let bestD = -1;
            for (let i = 0; i < detentsArr.length; i += 1) {
                const d = projected - detentsArr[i];
                const ad = d < 0 ? -d : d;
                if (bestD < 0 || ad < bestD) { bestD = ad; bestI = i; }
            }
            const target = detentsArr[bestI];
            withTiming(reveal, target, { duration: SNAP_SEC });
            runOnBackground((i: number) => {
                setTimeout(() => { emit('snap', i); }, SNAP_MS);
            })(bestI);
        });

    useGestureDetector(handleRef, pan);

    return () => {
        // React to `open` changes (render closure tracks props.open).
        const open = props.open ?? false;
        if (open !== lastOpen) {
            lastOpen = open;
            void animateReveal(open ? openReveal : floor);
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
