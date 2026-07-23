/**
 * The unified sheet pan — one gesture implementation for every drag mode.
 * Merged mechanically from lynx-navigation's inline `BottomSheet` pan
 * (handle-attached, persistent floor, `openToLift` snap candidates) and
 * `SheetDragController` (full-surface arbitration against an adopted
 * inner scrollable, drag-to-dismiss, gen-stamped claims).
 *
 * Two attachment shapes:
 * - **handle** (`surface: false`, default): the caller attaches the pan
 *   to a dedicated handle/grabber element — touches there always drag
 *   the sheet, so ownership is claimed at `onStart` and no arbitration
 *   runs. A raw `<list>` body keeps scrolling untouched.
 * - **surface** (`surface: true`): the caller attaches the pan to the
 *   whole sheet surface and provides the `ScrollDragHost` SVs; ownership
 *   resolves on the first `onUpdate` frame through `decideDragOwner`
 *   (see math.ts for the 8-step table). CONTENT-owned gestures are
 *   *passive*: the pan stays activated but writes nothing and makes no
 *   BG hops — the native scroll runs concurrently by construction. On
 *   web a browser-claimed scroll `pointercancel`s us into the no-op
 *   `owner !== OWNER_SHEET` onEnd branch.
 *
 * **Settle-grab correctness** (ported verbatim): claiming cancels any
 * in-flight settle tween via lynx-motion's `cancelAnimation` (a plain SV
 * write does NOT cancel), and stamps a claim generation the caller's BG
 * hops carry — so delayed settle/dismiss work can compare-and-bail when
 * a newer gesture superseded it, and grabbing the sheet mid-settle can't
 * fight the tween.
 *
 * MT/BG split: all handlers run on MT and write the reveal SV directly
 * per frame (auto-flushing, #681); BG hops only at claim (`onClaim`) and
 * release (`onRelease`). Worklet locals cross to BG as ARGUMENTS.
 */
import { Gesture, runOnBackground, type SharedValue } from '@sigx/lynx';
import { cancelAnimation, withTiming } from '@sigx/lynx-motion';
import type { SheetEngine } from './engine.js';
import { SNAP_SEC } from './engine.js';
import {
    decideDragOwner,
    GRABBER_HEIGHT,
    nearestDetentIndex,
    OWNER_SHEET,
    OWNER_UNDECIDED,
    shouldDismiss,
} from './math.js';

/** Minimum movement before the gesture activates (lets taps pass through). */
export const MIN_DISTANCE = 6;

/** `onRelease` kind: the sheet settled at a snap candidate. */
export const RELEASE_SNAP = 0;
/** `onRelease` kind: the release projected past the dismiss line. */
export const RELEASE_DISMISS = 1;

export interface SheetPanConfig {
    /** Full-surface arbitration mode (requires the scroll SVs below). */
    surface?: boolean;
    /** Height of the always-claims chrome zone (surface mode). */
    grabberPx?: number;
    /** `'grabber'` drag mode: only the chrome zone claims, body never drags. */
    grabberOnly?: boolean;
    /** Activation slop; default 6 (the inline sheet's tap-friendly value). */
    minDistance?: number;
    /** Adopted inner scrollable's live offset (`ScrollDragHost.scrollOffsetY`). */
    scrollOffsetY?: SharedValue<number>;
    /** Adopted-scrollable presence flag (`ScrollDragHost.hasVerticalScroll`). */
    hasVerticalScroll?: SharedValue<number>;
    /**
     * Page-coord Y of the sheet's bottom edge — `sheetTop = bottomEdge -
     * combined` for the grabber-zone test. A screen-anchored sheet seeds
     * this with the screen height. Required in surface mode.
     */
    bottomEdgeSV?: SharedValue<number>;
    /**
     * BG hop at claim, carrying the claim generation — the route adapter
     * stamps its gen signal + takes the gesture scroll-lock here. Omit
     * for sheets with no claim-time BG work (the inline handle pan).
     */
    onClaim?: (gen: number) => void;
    /**
     * BG hop at release: `kind` is `RELEASE_SNAP` (with the candidate
     * index the sheet is settling toward) or `RELEASE_DISMISS` (index
     * `-1`). `gen` is the claim generation for compare-and-bail. The
     * inline sheet debounce-emits its snap event here; the route adapter
     * gen-guards its settle/dismiss commit.
     */
    onRelease: (kind: number, candidateIndex: number, gen: number) => void;
}

/**
 * Build the pan gesture for a sheet engine. Call at component setup and
 * attach with `useGestureDetector(ref, pan)` — to the handle element in
 * handle mode, the whole sheet surface in surface mode.
 */
export function createSheetPan(
    engine: SheetEngine,
    cfg: SheetPanConfig,
): ReturnType<typeof Gesture.Pan> {
    // Destructured at setup so the worklets capture the SV/ref identities
    // directly (property reads off an object don't worklet-capture).
    const reveal = engine.reveal;
    const combined = engine.combined;
    const geomRef = engine.geomRef;
    const openRestRef = engine.openRestRef;
    const drag = engine.drag;
    // Plain numbers so they worklet-capture as literals.
    const openToLift = engine.openToLift ? 1 : 0;
    const surface = cfg.surface === true ? 1 : 0;
    const grabberPx = cfg.grabberPx ?? GRABBER_HEIGHT;
    const grabberOnly = cfg.grabberOnly === true ? 1 : 0;
    const scrollOffsetY = cfg.scrollOffsetY ?? null;
    const hasVerticalScroll = cfg.hasVerticalScroll ?? null;
    const bottomEdgeSV = cfg.bottomEdgeSV ?? null;
    const onClaim = cfg.onClaim ?? null;
    const hasClaim = onClaim ? 1 : 0;
    const onRelease = cfg.onRelease;

    // Fail fast at setup: without these, surface arbitration would run on
    // silent 0-fallbacks and make wrong ownership decisions on-device.
    if (surface === 1 && (!scrollOffsetY || !hasVerticalScroll || !bottomEdgeSV)) {
        throw new Error(
            '[lynx-sheet] createSheetPan: surface mode requires scrollOffsetY, '
            + 'hasVerticalScroll and bottomEdgeSV (see ScrollDragHost)',
        );
    }

    return Gesture.Pan()
        .axis('y')
        .minDistance(cfg.minDistance ?? MIN_DISTANCE)
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: { params?: { pageY?: number; pageX?: number } }) => {
            'main thread';
            // `dragEnabled={false}` freezes the gesture — the single gate,
            // pushed through syncGeom (a render-side SV `.value` write is a
            // BG no-op and would never arrive, #758). Drag is NOT disabled
            // at the floor: a collapsed sheet must be draggable OPEN (the
            // clamp in onUpdate keeps it from going below).
            if (geomRef.current.gate === 0) {
                drag.current.active = 0;
                return;
            }
            const p = e && e.params;
            const y = (p && p.pageY) || 0;
            drag.current.startX = (p && p.pageX) || 0;
            drag.current.startY = y;
            drag.current.prevY = y;
            drag.current.prevT = Date.now();
            drag.current.vel = 0;
            drag.current.active = 1;
            if (surface === 0) {
                // Handle-attached pan: the handle IS the grabber — claim now.
                drag.current.owner = OWNER_SHEET;
                drag.current.claimY = y;
                drag.current.startReveal = reveal.current.value;
                drag.current.gen = Date.now();
                // Stop any in-flight open/close tween or it fights the finger.
                cancelAnimation(reveal);
                if (hasClaim === 1) runOnBackground(onClaim!)(drag.current.gen);
            } else {
                // Ownership is decided on the first onUpdate frame — one
                // frame of latency, nothing written yet, so no visual cost.
                // Deciding there (not here) keeps the decision in ONE
                // worklet and sidesteps whether onBegin/onStart payloads
                // carry a usable pre-slop position on every platform.
                drag.current.owner = OWNER_UNDECIDED;
            }
        })
        .onUpdate((e: { params?: { pageY?: number; pageX?: number } }) => {
            'main thread';
            if (drag.current.active === 0) return;
            const p = e && e.params;
            const y = (p && p.pageY) || 0;
            const x = (p && p.pageX) || 0;
            const frameDown = y > drag.current.prevY ? 1 : 0;
            // Velocity is tracked regardless of owner so a later claim
            // (handoff) inherits an accurate fling velocity immediately.
            const now = Date.now();
            const dt = now - drag.current.prevT;
            if (dt > 0) drag.current.vel = ((y - drag.current.prevY) / dt) * 1000;
            drag.current.prevY = y;
            drag.current.prevT = now;

            if (surface === 1 && drag.current.owner !== OWNER_SHEET) {
                const decided = decideDragOwner({
                    dx: x - drag.current.startX,
                    dy: y - drag.current.startY,
                    frameDown,
                    startPageY: drag.current.startY,
                    combinedPx: combined.current.value,
                    maxPx: geomRef.current.max,
                    bottomEdgePageY: bottomEdgeSV ? bottomEdgeSV.current.value : 0,
                    grabberPx,
                    grabberOnly,
                    hasScroll: hasVerticalScroll ? hasVerticalScroll.current.value : 0,
                    scrollOffsetY: scrollOffsetY ? scrollOffsetY.current.value : 0,
                    currentOwner: drag.current.owner,
                });
                if (decided === OWNER_SHEET) {
                    drag.current.owner = OWNER_SHEET;
                    drag.current.claimY = y;
                    drag.current.startReveal = reveal.current.value;
                    drag.current.gen = Date.now();
                    // A plain SV write does NOT cancel an in-flight settle
                    // tween — grabbing mid-settle must stop it explicitly or
                    // the tween fights the finger.
                    cancelAnimation(reveal);
                    if (hasClaim === 1) runOnBackground(onClaim!)(drag.current.gen);
                } else {
                    drag.current.owner = decided;
                }
            }
            if (drag.current.owner !== OWNER_SHEET) return;

            // Drag UP (dy < 0) grows the sheet: reveal increases. (SV
            // writes auto-flush per frame — #681.) A dismissible sheet may
            // be pulled below its floor toward 0; a persistent one clamps
            // at the floor.
            const dy = y - drag.current.claimY;
            let next = drag.current.startReveal - dy;
            const min = geomRef.current.dismissible === 1 ? 0 : geomRef.current.min;
            if (next < min) next = min;
            if (next > geomRef.current.max) next = geomRef.current.max;
            reveal.current.value = next;
        })
        .onEnd(() => {
            'main thread';
            if (drag.current.active === 0) return;
            if (drag.current.owner !== OWNER_SHEET) {
                // Passive/undecided gesture: no snap, no BG hop, no lock
                // held. On web this branch is load-bearing — a browser-
                // claimed scroll ends our pan via pointercancel.
                drag.current.owner = OWNER_UNDECIDED;
                drag.current.active = 0;
                return;
            }
            drag.current.owner = OWNER_UNDECIDED;
            drag.current.active = 0;
            const r = reveal.current.value;
            if (
                geomRef.current.dismissible === 1
                && shouldDismiss(r, drag.current.vel, geomRef.current.min)
            ) {
                withTiming(reveal, 0, { duration: SNAP_SEC });
                runOnBackground(onRelease)(RELEASE_DISMISS, -1, drag.current.gen);
                return;
            }
            // With `openToLift` the low "open rest" is the CAPTURED lifted
            // position (== the keyboard height), not a BG-computed detent —
            // so a release near the compact rest returns to exactly where
            // the keyboard sat. Candidates: floor, captured rest, top.
            const cands = openToLift === 1
                ? [geomRef.current.min, openRestRef.current.rest, geomRef.current.max]
                : geomRef.current.detents;
            const i = nearestDetentIndex(r, drag.current.vel, cands);
            const target = i >= 0 ? cands[i] : r;
            withTiming(reveal, target, { duration: SNAP_SEC });
            runOnBackground(onRelease)(RELEASE_SNAP, i, drag.current.gen);
        });
}
