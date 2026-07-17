/**
 * `<SheetDragController>` — renderless full-surface pan recognizer for
 * `presentation: 'sheet'` entries. Mounted by `<SheetSlot>` for the top
 * resting sheet only (never mid-transition); attaches to the sheet
 * `<Layer>`'s host view, whose translated-down bounds are exactly the
 * visible sheet surface — so one detector covers the grabber region AND
 * the body, and the old 28px overlay strip is gone.
 *
 * **Arbitration** (UX reference: iOS detents / gorhom's bottom-sheet). Each
 * gesture resolves an owner — UNDECIDED → SHEET | CONTENT — on its first
 * onUpdate frame:
 *
 *   1. touch in the top `GRABBER_HEIGHT`px of the surface → SHEET (chrome)
 *   2. mostly-horizontal drag → CONTENT (native `.axis('y')` never fires
 *      these; the check is load-bearing on web, whose pan fallback ignores
 *      the axis config)
 *   3. `dragHandle: 'grabber'` mode → CONTENT (body never drags)
 *   4. no adopted vertical scrollable → SHEET (plain-content sheets)
 *   5. sheet below max detent → SHEET (content is rest-locked anyway)
 *   6. at max, dragging up → CONTENT
 *   7. at max, dragging down, scroll offset ≤ 0 → SHEET (`≤` covers iOS
 *      bounce-negative offsets)
 *   8. at max, dragging down, scroll offset > 0 → CONTENT, watching for the
 *      one allowed mid-gesture handoff: content reaches top under the
 *      finger while still moving down → SHEET takes over. Never the
 *      reverse (native can't re-deliver an in-flight touch to a re-enabled
 *      scroll pan).
 *
 * CONTENT-owned gestures are *passive*: the pan stays activated but writes
 * nothing and makes no BG hops — the native scroll runs concurrently by
 * construction (see lynx-gestures' scroll-context.ts for why the scroll
 * pan is outside the gesture arena). On web a browser-claimed scroll
 * `pointercancel`s us into the no-op `owner !== SHEET` onEnd branch.
 *
 * Scroll state arrives through the `ScrollDragHost` the `<SheetSlot>`
 * provides (`@sigx/lynx`): the adopted inner `<ScrollView>` mirrors its
 * live offset into `scrollOffsetY` and flips `hasVerticalScroll` — both
 * eagerly allocated on the sheet side, because worklet captures are static
 * at register time.
 *
 * **Settle-grab correctness**: claiming cancels any in-flight settle tween
 * via lynx-motion's `cancelAnimation` (a plain SV write does NOT cancel),
 * and every delayed BG settle/dismiss timeout carries the claiming
 * gesture's generation, compare-and-bailing against `genSignal` — so
 * grabbing the sheet mid-settle can't fight the tween and a stale
 * `commitSheetDismiss` can't pop the sheet under the finger.
 *
 * MT/BG split as before: all gesture handlers run on MT and write the
 * sheet SV directly per frame (auto-flushing since #681); BG hops only at
 * claim (gen + lock) and settle (dismiss commit / detent record + unlock).
 * Per-gesture transient state is a `useMainThreadRef` object — each
 * handler is its own worklet with its own deep-copied `_c`, so a plain
 * closure object does not share mutations (see `<Draggable>`).
 */
import {
    component,
    Gesture,
    runOnBackground,
    useGestureDetector,
    useMainThreadRef,
    type Define,
    type MainThread,
    type MainThreadRef,
    type PrimitiveSignal,
    type ScrollDragHost,
} from '@sigx/lynx';
import { cancelAnimation, withTiming } from '@sigx/lynx-motion';
import { useNavInternals } from '../hooks/use-nav-internal.js';
import { nearestSnap, shouldDismiss } from '../internal/sheet-math.js';
import { SCREEN_HEIGHT } from '../internal/screen-width.js';

/** Height of the always-drags chrome zone at the sheet's top edge. */
const GRABBER_HEIGHT = 28;
/** Minimum movement before the gesture activates (lets taps pass through). */
const MIN_DISTANCE = 8;
const SNAP_DURATION_SEC = 0.18;
/** "At max detent" tolerance in progress space. */
const MAX_EPS = 0.001;
/**
 * Pre-computed ms for the BG-side `setTimeout` — module-level so both the
 * MT worklet and the BG callback closure can see it (locals inside an MT
 * worklet body are MT-only; see EdgeBackHandle).
 */
const SNAP_DURATION_MS = Math.round(SNAP_DURATION_SEC * 1000);

/** Owner states — plain numbers so they worklet-capture as literals. */
const OWNER_UNDECIDED = 0;
const OWNER_SHEET = 1;
const OWNER_CONTENT = 2;

type SheetDragControllerProps =
    /** Entry key of the sheet this controller drives — pins the dismiss commit. */
    & Define.Prop<'entryKey', string, true>
    /** Snap progress values (ascending) for the active sheet. */
    & Define.Prop<'snapProgresses', readonly number[], true>
    /** Largest snap fraction — fixes the progress→px travel mapping. */
    & Define.Prop<'maxSnapFraction', number, true>
    /** `'surface'`: body drags; `'grabber'`: only the top strip zone claims. */
    & Define.Prop<'dragMode', 'surface' | 'grabber', true>
    /** The sheet Layer's host element ref — the pan attaches here. */
    & Define.Prop<'hostRef', MainThreadRef<MainThread.Element | null>, true>
    /** Scroll-coordination host the `<SheetSlot>` allocated + provided. */
    & Define.Prop<'dragHost', ScrollDragHost, true>
    /** BG generation signal — stale settle/dismiss timeouts compare-and-bail. */
    & Define.Prop<'genSignal', PrimitiveSignal<number>, true>
    /** BG callback: a sheet-owned gesture began/ended (gates content scroll). */
    & Define.Prop<'onGestureLock', (locked: boolean) => void, true>
    /** BG callback: the sheet settled at a (non-dismiss) snap progress. */
    & Define.Prop<'onSettle', (progress: number) => void, true>;

export const SheetDragController = component<SheetDragControllerProps>(({ props }) => {
    // Snapshot config at setup — `<SheetSlot>` keys this component by snap
    // signature + drag mode, so a config change remounts it with fresh
    // worklet captures. Plain arrays/numbers/strings capture cleanly.
    const entryKey = props.entryKey;
    const snapProgresses = [...props.snapProgresses];
    const minSnapProgress = snapProgresses[0] ?? 0;
    const maxSnapFraction = props.maxSnapFraction;
    /** px of travel for the full progress range [0, 1]. */
    const travelPx = Math.max(1, maxSnapFraction * SCREEN_HEIGHT);
    const grabberOnly = props.dragMode === 'grabber' ? 1 : 0;
    const hostRef = props.hostRef;
    const onSettle = props.onSettle;
    const onGestureLock = props.onGestureLock;
    const genSignal = props.genSignal;
    // Destructured at setup so the worklets capture the SV identities
    // directly (property reads off an object don't worklet-capture).
    const scrollOffsetY = props.dragHost.scrollOffsetY;
    const hasVerticalScroll = props.dragHost.hasVerticalScroll;

    const internals = useNavInternals();
    const sheetProgress = internals.sheetProgress;
    const commitSheetDismiss = internals.commitSheetDismiss;

    // Per-gesture transient state — a `useMainThreadRef`; see header.
    const state = useMainThreadRef({
        startPageX: 0,
        startPageY: 0,
        /** Baseline for progress mapping — set at CLAIM, not touch start. */
        claimPageY: 0,
        startProgress: 0,
        prevPageY: 0,
        prevTime: 0,
        velocity: 0, // px/sec, positive = downward
        owner: 0, // OWNER_*
        gen: 0,
    });

    const pan = Gesture.Pan()
        .axis('y')
        .minDistance(MIN_DISTANCE)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: any) => {
            'main thread';
            if (!sheetProgress) return;
            const p = e && e.params;
            const pageY = (p && p.pageY) || 0;
            state.current.startPageX = (p && p.pageX) || 0;
            state.current.startPageY = pageY;
            state.current.prevPageY = pageY;
            state.current.prevTime = Date.now();
            state.current.velocity = 0;
            state.current.owner = OWNER_UNDECIDED;
            // Ownership is decided on the first onUpdate frame — one frame
            // of latency, nothing written yet, so no visual cost. Deciding
            // there (not here) keeps the decision in ONE worklet and
            // sidesteps whether onBegin/onStart payloads carry a usable
            // pre-slop position on every platform.
        })
        .onUpdate((e: any) => {
            'main thread';
            if (!sheetProgress) return;
            const p = e && e.params;
            const pageY = (p && p.pageY) || 0;
            const pageX = (p && p.pageX) || 0;
            const frameDown = pageY > state.current.prevPageY;

            // Velocity is tracked regardless of owner so a later claim
            // (handoff) inherits an accurate fling velocity immediately.
            const now = Date.now();
            const dt = now - state.current.prevTime;
            if (dt > 0) {
                state.current.velocity =
                    ((pageY - state.current.prevPageY) / dt) * 1000;
            }
            state.current.prevPageY = pageY;
            state.current.prevTime = now;

            let claim = 0;
            if (state.current.owner === OWNER_UNDECIDED) {
                const dx = pageX - state.current.startPageX;
                const dy = pageY - state.current.startPageY;
                if (dx === 0 && dy === 0) return; // no movement yet — next frame
                const prog = sheetProgress.current.value;
                const sheetTopPx = SCREEN_HEIGHT - prog * travelPx;
                if (state.current.startPageY - sheetTopPx < GRABBER_HEIGHT) {
                    claim = 1; // chrome zone always drags the sheet
                } else if (Math.abs(dx) > Math.abs(dy)) {
                    state.current.owner = OWNER_CONTENT; // web axis gate
                } else if (grabberOnly === 1) {
                    state.current.owner = OWNER_CONTENT; // body never drags
                } else if (hasVerticalScroll.current.value === 0) {
                    claim = 1; // plain-content sheet
                } else if (prog < 1 - MAX_EPS) {
                    claim = 1; // below max — content is rest-locked
                } else if (dy < 0) {
                    state.current.owner = OWNER_CONTENT; // at max, dragging up
                } else if (scrollOffsetY.current.value <= 0) {
                    claim = 1; // at max, down, content at top
                } else {
                    state.current.owner = OWNER_CONTENT; // content scrolls back
                }
            } else if (state.current.owner === OWNER_CONTENT) {
                // One-way mid-gesture handoff: content reached top under the
                // finger while still moving down. Guarded off for grabber
                // mode (body must never drag) — the other CONTENT parkings
                // (horizontal, at-max-up) can't satisfy the at-max + down +
                // at-top conjunction without genuinely becoming a collapse
                // pull, at which point taking over is the right feel.
                if (
                    grabberOnly === 0
                    && frameDown
                    && sheetProgress.current.value >= 1 - MAX_EPS
                    && hasVerticalScroll.current.value === 1
                    && scrollOffsetY.current.value <= 0
                ) {
                    claim = 1;
                }
            }

            if (claim === 1) {
                state.current.owner = OWNER_SHEET;
                state.current.claimPageY = pageY;
                state.current.startProgress = sheetProgress.current.value;
                state.current.gen = Date.now();
                // A plain SV write does NOT cancel an in-flight settle tween
                // — grabbing mid-settle must stop it explicitly or the tween
                // fights the finger for up to SNAP_DURATION_MS.
                cancelAnimation(sheetProgress);
                runOnBackground((g: number) => {
                    genSignal.value = g; // invalidates stale settle timeouts
                    onGestureLock(true);
                })(state.current.gen);
            }

            if (state.current.owner !== OWNER_SHEET) return;

            // Drag down (dy > 0) closes: progress decreases. (SV writes
            // auto-flush per frame — #681.)
            const dyClaim = pageY - state.current.claimPageY;
            const prog2 = state.current.startProgress - dyClaim / travelPx;
            sheetProgress.current.value = Math.max(0, Math.min(1, prog2));
        })
        .onEnd(() => {
            'main thread';
            if (!sheetProgress) return;
            if (state.current.owner !== OWNER_SHEET) {
                // Passive/undecided gesture: no snap, no BG hop, no lock
                // held. On web this branch is load-bearing — a browser-
                // claimed scroll ends our pan via pointercancel.
                state.current.owner = OWNER_UNDECIDED;
                return;
            }
            state.current.owner = OWNER_UNDECIDED;
            const prog = sheetProgress.current.value;
            if (shouldDismiss(prog, state.current.velocity, minSnapProgress, travelPx)) {
                withTiming(sheetProgress, 0, { duration: SNAP_DURATION_SEC });
                // Gen-guarded: a re-grab during the dismiss settle supersedes
                // this timeout, so the sheet can't pop under the new finger.
                runOnBackground((g: number) => {
                    setTimeout(() => {
                        if (genSignal.value !== g) return;
                        commitSheetDismiss(entryKey);
                    }, SNAP_DURATION_MS);
                })(state.current.gen);
            } else {
                const target = nearestSnap(prog, state.current.velocity, snapProgresses, travelPx);
                withTiming(sheetProgress, target, { duration: SNAP_DURATION_SEC });
                // Deferred until the snap animation lands (mirrors dismiss):
                // record the detent FIRST, release the scroll lock SECOND, in
                // one BG tick — so `enable-scroll` recomputes exactly once
                // with consistent rest state (a sub-max settle hands over to
                // the rest-lock with no unlock gap). Worklet locals cross to
                // BG as ARGUMENTS (see EdgeBackHandle's notes).
                runOnBackground((t: number, g: number) => {
                    setTimeout(() => {
                        if (genSignal.value !== g) return;
                        onSettle(t);
                        onGestureLock(false);
                    }, SNAP_DURATION_MS);
                })(target, state.current.gen);
            }
        });

    useGestureDetector(hostRef, pan);

    return () => null;
});
