/**
 * Pure math for the `'sheet'` presentation — snap-point ↔ progress mapping
 * and release (snap/dismiss) decisions.
 *
 * The sheet runs on a dedicated `sheetProgress` SharedValue with "open
 * fraction" semantics: `0` = off-screen (`translateY = SCREEN_HEIGHT`),
 * `1` = fully open at the LARGEST snap point
 * (`translateY = (1 - maxSnapFraction) * SCREEN_HEIGHT`). One fixed linear
 * mapper covers push, pop, rest, and drag — the SV value alone encodes
 * the sheet position, so `withTiming` between any two progress values
 * animates correctly without per-kind input/output ranges.
 *
 * Kept separate from the gesture worklet so the snap/dismiss logic is
 * unit-testable — the MT worklet runtime isn't available under
 * `@sigx/lynx-testing` (these functions are worklet-safe: pure, no
 * captures, ES5-level operations only).
 */

/**
 * Progress value at which a snap fraction rests. With snaps `[0.4, 0.9]`
 * the sheet travels `SCREEN_HEIGHT → 0.1 * SCREEN_HEIGHT`, so fraction
 * `0.4` rests at progress `0.4 / 0.9 ≈ 0.444` and `0.9` at `1`.
 */
export function snapToProgress(fraction: number, maxFraction: number): number {
    if (maxFraction <= 0) return 0;
    return Math.max(0, Math.min(1, fraction / maxFraction));
}

/** Vertical rest offset (px from screen top) for a progress value. */
export function progressToOffsetY(
    progress: number,
    maxFraction: number,
    screenHeight: number,
): number {
    const minOffset = (1 - maxFraction) * screenHeight;
    return screenHeight - progress * (screenHeight - minOffset);
}

/** Inverse of `progressToOffsetY` — progress for a translateY offset. */
export function offsetYToProgress(
    offsetY: number,
    maxFraction: number,
    screenHeight: number,
): number {
    const travel = maxFraction * screenHeight;
    if (travel <= 0) return 0;
    return Math.max(0, Math.min(1, (screenHeight - offsetY) / travel));
}

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
 * Fraction of the smallest snap's progress below which a (projected)
 * release dismisses. Landing less than half-way to the lowest detent =
 * the user let go most of the way down.
 */
const DISMISS_PROGRESS_FACTOR = 0.5;

/**
 * Projected release progress: where the sheet would land if the finger's
 * velocity (`velocityY` px/sec, positive = downward) carried it for
 * `PROJECTION_SEC`. Unclamped — callers compare against thresholds.
 */
export function projectProgress(
    progress: number,
    velocityY: number,
    travelPx: number,
): number {
    'main thread';
    if (travelPx <= 0) return progress;
    return progress - (velocityY * PROJECTION_SEC) / travelPx;
}

/**
 * Whether a release should dismiss the sheet — true when the projected
 * landing position falls below the dismiss line under the lowest detent.
 */
export function shouldDismiss(
    progress: number,
    velocityY: number,
    minSnapProgress: number,
    travelPx: number,
): boolean {
    'main thread';
    return (
        projectProgress(progress, velocityY, travelPx) <
        minSnapProgress * DISMISS_PROGRESS_FACTOR
    );
}

/**
 * Pick the snap progress to settle at on release: the detent nearest the
 * PROJECTED landing position. A fling naturally selects the next detent
 * in its direction; a slow release picks the nearest one to the finger.
 * `snapProgresses` must be ascending.
 */
export function nearestSnap(
    progress: number,
    velocityY: number,
    snapProgresses: readonly number[],
    travelPx: number,
): number {
    'main thread';
    if (snapProgresses.length === 0) return progress;
    const proj = projectProgress(progress, velocityY, travelPx);
    let nearest = snapProgresses[0];
    let bestDist = Math.abs(proj - nearest);
    for (let i = 1; i < snapProgresses.length; i += 1) {
        const d = Math.abs(proj - snapProgresses[i]);
        if (d < bestDist) {
            bestDist = d;
            nearest = snapProgresses[i];
        }
    }
    return nearest;
}

/**
 * Floor for sheet transition durations — keeps very low detents from
 * snapping open/closed instantly under velocity matching.
 */
export const SHEET_MIN_DURATION_SEC = 0.15;

/**
 * Sheet transition duration, velocity-matched to the card/modal slide:
 * those travel the full screen in `fullSlideDurationSec`, while a sheet
 * only travels to its detent — a flat duration made the sheet move at a
 * fraction of the modal's speed and read as sluggish (#290).
 * `heightFraction` is the share of screen height traveled (snap progress
 * × largest snap fraction).
 */
export function sheetDurationSec(
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
        Math.max(SHEET_MIN_DURATION_SEC, scaled),
    );
}

/** Default snap points when a sheet screen declares none. */
export const DEFAULT_SNAP_POINTS: readonly number[] = [0.5];

/**
 * Normalize a screen's declared snap config: drop fractions outside
 * (0, 1] (a snap point past the screen is a config error, not something
 * to reinterpret), sort ascending, fall back to the default when nothing
 * valid remains.
 */
export function resolveSnapPoints(
    declared: readonly number[] | undefined,
): readonly number[] {
    const cleaned = (declared ?? [])
        .filter((f) => typeof f === 'number' && f > 0 && f <= 1)
        .sort((a, b) => a - b);
    return cleaned.length > 0 ? cleaned : DEFAULT_SNAP_POINTS;
}

/** Resolve the initial snap progress from config (default: most open). */
export function initialSnapProgress(
    snapPoints: readonly number[],
    initialSnapIndex: number | undefined,
): number {
    const maxFraction = snapPoints[snapPoints.length - 1];
    const idx =
        initialSnapIndex != null &&
        initialSnapIndex >= 0 &&
        initialSnapIndex < snapPoints.length
            ? initialSnapIndex
            : snapPoints.length - 1;
    return snapToProgress(snapPoints[idx], maxFraction);
}
