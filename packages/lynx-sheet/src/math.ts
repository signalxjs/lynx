/**
 * Pure sheet math in reveal-px space — release (snap/dismiss) decisions,
 * transition durations, and drag-ownership arbitration.
 *
 * `reveal` is the sheet's visible height in px (0 = fully hidden). Both
 * sheet frontends drive a reveal SharedValue; everything their worklets
 * decide is delegated here so the logic is unit-testable — the MT worklet
 * runtime isn't available under `@sigx/lynx-testing`. All functions are
 * worklet-safe: pure, no captures, ES5-level operations only.
 */

/**
 * How far ahead (seconds) a release projects the finger's velocity to pick
 * its landing position. On-device testing showed a raw velocity threshold
 * (the original 300 px/s, mirroring EdgeBackHandle) misfires for sheets: a
 * controlled ~360 px/s downward drag from the upper detent read as a
 * "dismiss fling" even though the finger clearly aimed at the lower
 * detent. Projecting position instead unifies both decisions: a genuine
 * fling projects past the dismiss line from anywhere; a controlled drag
 * projects near a detent and settles there.
 */
export const PROJECTION_SEC = 0.2;

/**
 * Fraction of the floor detent below which a (projected) release
 * dismisses. Landing less than half-way to the lowest detent = the user
 * let go most of the way down.
 */
const DISMISS_FACTOR = 0.5;

/**
 * Projected release reveal: where the sheet would land if the finger's
 * velocity (`velocityY` px/sec, positive = downward) carried it for
 * `PROJECTION_SEC`. Unclamped — callers compare against thresholds.
 */
export function projectReveal(revealPx: number, velocityY: number): number {
    'main thread';
    return revealPx - velocityY * PROJECTION_SEC;
}

/**
 * Whether a release should dismiss the sheet — true when the projected
 * landing position falls below the dismiss line under the floor detent.
 */
export function shouldDismiss(
    revealPx: number,
    velocityY: number,
    floorPx: number,
): boolean {
    'main thread';
    return projectReveal(revealPx, velocityY) < floorPx * DISMISS_FACTOR;
}

/**
 * Pick the candidate index to settle at on release: the one nearest the
 * PROJECTED landing position. A fling naturally selects the next
 * candidate in its direction; a slow release picks the nearest one to the
 * finger. `candidatesPx` must be ascending. Returns `-1` when empty.
 */
export function nearestDetentIndex(
    revealPx: number,
    velocityY: number,
    candidatesPx: readonly number[],
): number {
    'main thread';
    if (candidatesPx.length === 0) return -1;
    const proj = projectReveal(revealPx, velocityY);
    let nearest = 0;
    let bestDist = Math.abs(proj - candidatesPx[0]);
    for (let i = 1; i < candidatesPx.length; i += 1) {
        const d = Math.abs(proj - candidatesPx[i]);
        if (d < bestDist) {
            bestDist = d;
            nearest = i;
        }
    }
    return nearest;
}

/**
 * Floor for sheet transition durations — keeps very low detents from
 * snapping open/closed instantly under velocity matching.
 */
export const REVEAL_MIN_DURATION_SEC = 0.15;

/**
 * Sheet transition duration, velocity-matched to the card/modal slide:
 * those travel the full screen in `fullSlideDurationSec`, while a sheet
 * only travels to its detent — a flat duration made the sheet move at a
 * fraction of the modal's speed and read as sluggish (#290).
 * `heightFraction` is the share of screen height traveled.
 */
export function revealDurationSec(
    heightFraction: number,
    fullSlideDurationSec: number,
): number {
    const scaled =
        fullSlideDurationSec * Math.min(1, Math.max(0, heightFraction));
    // Floor, but never past the full-slide duration itself — full-height
    // travel must equal `fullSlideDurationSec` even if a caller passes a
    // duration below the floor.
    return Math.min(
        fullSlideDurationSec,
        Math.max(REVEAL_MIN_DURATION_SEC, scaled),
    );
}

// ---------------------------------------------------------------------------
// Drag-ownership arbitration
// ---------------------------------------------------------------------------

/** "At max detent" tolerance in reveal px. */
export const MAX_EPS_PX = 0.5;

/** Height of the always-drags chrome zone at the sheet's top edge. */
export const GRABBER_HEIGHT = 28;

/** Owner states — plain numbers so they worklet-capture as literals. */
export const OWNER_UNDECIDED = 0;
export const OWNER_SHEET = 1;
export const OWNER_CONTENT = 2;

/**
 * Inputs to one arbitration step. Flags are `0 | 1` numbers, matching the
 * SharedValues they're typically read from in worklets.
 */
export interface DragOwnerInput {
    /** Finger travel since touch start (px). */
    dx: number;
    dy: number;
    /** `1` when this frame moved downward (pageY > previous frame's). */
    frameDown: number;
    /** Touch-start Y in page coords. */
    startPageY: number;
    /** Current visible sheet height (px). */
    combinedPx: number;
    /** Largest detent (px) — "at max" gates content scrolling. */
    maxPx: number;
    /**
     * Page-coord Y of the sheet's bottom edge — `SCREEN_HEIGHT` for a
     * screen-anchored route sheet; an inline sheet passes its own
     * measured bottom edge. `sheetTop = bottomEdgePageY - combinedPx`.
     */
    bottomEdgePageY: number;
    /** Height of the always-claims chrome zone; `0` disables it. */
    grabberPx: number;
    /** `1` in grabber-only drag mode (the body never drags the sheet). */
    grabberOnly: number;
    /** `1` when an adopted inner vertical scrollable exists. */
    hasScroll: number;
    /** The adopted scrollable's live scroll offset (px). */
    scrollOffsetY: number;
    /** Current owner (`OWNER_*`) — decisions are sticky except handoff. */
    currentOwner: number;
}

/**
 * Resolve who owns this drag frame — the 8-step UNDECIDED → SHEET|CONTENT
 * arbitration (UX reference: iOS detents / gorhom's bottom-sheet):
 *
 *   1. touch in the top `grabberPx` of the surface → SHEET (chrome)
 *   2. mostly-horizontal drag → CONTENT (native `.axis('y')` never fires
 *      these; the check is load-bearing on web, whose pan fallback
 *      ignores the axis config)
 *   3. grabber-only mode → CONTENT (body never drags)
 *   4. no adopted vertical scrollable → SHEET (plain-content sheets)
 *   5. sheet below max detent → SHEET (content is rest-locked anyway)
 *   6. at max, dragging up → CONTENT
 *   7. at max, dragging down, scroll offset ≤ 0 → SHEET (`≤` covers iOS
 *      bounce-negative offsets)
 *   8. at max, dragging down, scroll offset > 0 → CONTENT, watching for
 *      the one allowed mid-gesture handoff: content reaches top under the
 *      finger while still moving down → SHEET takes over. Never the
 *      reverse (native can't re-deliver an in-flight touch to a
 *      re-enabled scroll pan).
 *
 * A SHEET decision is final for the gesture; CONTENT re-evaluates only
 * the step-8 handoff conjunction (guarded off for grabber-only mode — the
 * other CONTENT parkings can't satisfy at-max + down + at-top without
 * genuinely becoming a collapse pull, at which point taking over is the
 * right feel).
 */
export function decideDragOwner(i: DragOwnerInput): number {
    'main thread';
    if (i.currentOwner === OWNER_SHEET) return OWNER_SHEET;
    if (i.currentOwner === OWNER_CONTENT) {
        if (
            i.grabberOnly === 0
            && i.frameDown === 1
            && i.combinedPx >= i.maxPx - MAX_EPS_PX
            && i.hasScroll === 1
            && i.scrollOffsetY <= 0
        ) {
            return OWNER_SHEET;
        }
        return OWNER_CONTENT;
    }
    if (i.dx === 0 && i.dy === 0) return OWNER_UNDECIDED; // no movement yet
    const sheetTopPx = i.bottomEdgePageY - i.combinedPx;
    if (i.startPageY - sheetTopPx < i.grabberPx) return OWNER_SHEET;
    if (Math.abs(i.dx) > Math.abs(i.dy)) return OWNER_CONTENT; // web axis gate
    if (i.grabberOnly === 1) return OWNER_CONTENT;
    if (i.hasScroll === 0) return OWNER_SHEET;
    if (i.combinedPx < i.maxPx - MAX_EPS_PX) return OWNER_SHEET;
    if (i.dy < 0) return OWNER_CONTENT;
    if (i.scrollOffsetY <= 0) return OWNER_SHEET;
    return OWNER_CONTENT;
}
