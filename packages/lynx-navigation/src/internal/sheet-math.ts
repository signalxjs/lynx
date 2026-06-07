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
 * Downward release speed (px/sec) past which the sheet dismisses regardless
 * of position. Mirrors `EdgeBackHandle`'s `COMMIT_VELOCITY`.
 */
export const DISMISS_VELOCITY = 300;

/**
 * Fraction of the smallest snap's progress below which a slow release
 * dismisses. Released at less than half-way to the lowest detent = the
 * user dragged it most of the way down.
 */
const DISMISS_PROGRESS_FACTOR = 0.5;

/**
 * Whether a release should dismiss the sheet. `velocityY` is the finger's
 * vertical speed in px/sec, positive = downward (toward dismiss).
 */
export function shouldDismiss(
    progress: number,
    velocityY: number,
    minSnapProgress: number,
): boolean {
    'main thread';
    if (velocityY > DISMISS_VELOCITY) return true;
    // A fast upward fling is an explicit keep-open, even from a position
    // below the slow-release dismiss line.
    if (velocityY < -DISMISS_VELOCITY) return false;
    return progress < minSnapProgress * DISMISS_PROGRESS_FACTOR;
}

/**
 * Pick the snap progress to settle at on release. Velocity-biased: a fast
 * fling skips to the next detent in the fling direction even if the nearer
 * detent is behind the finger. `snapProgresses` must be ascending.
 */
export function nearestSnap(
    progress: number,
    velocityY: number,
    snapProgresses: readonly number[],
): number {
    'main thread';
    if (snapProgresses.length === 0) return progress;
    // Fast downward fling → next detent below; fast upward → next above.
    if (velocityY > DISMISS_VELOCITY || velocityY < -DISMISS_VELOCITY) {
        const downward = velocityY > 0;
        let candidate = downward
            ? snapProgresses[0]
            : snapProgresses[snapProgresses.length - 1];
        for (let i = 0; i < snapProgresses.length; i += 1) {
            const s = snapProgresses[i];
            if (downward) {
                // Largest detent strictly below current position.
                if (s < progress - 1e-6 && s > candidate) candidate = s;
            } else if (s > progress + 1e-6 && s < candidate) {
                // Smallest detent strictly above current position.
                candidate = s;
            }
        }
        return candidate;
    }
    // Slow release → plain nearest.
    let nearest = snapProgresses[0];
    let bestDist = Math.abs(progress - nearest);
    for (let i = 1; i < snapProgresses.length; i += 1) {
        const d = Math.abs(progress - snapProgresses[i]);
        if (d < bestDist) {
            bestDist = d;
            nearest = snapProgresses[i];
        }
    }
    return nearest;
}

/** Default snap points when a sheet screen declares none. */
export const DEFAULT_SNAP_POINTS: readonly number[] = [0.5];

/**
 * Normalize a screen's declared snap config: clamp fractions into (0, 1],
 * sort ascending, fall back to the default when empty/invalid.
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
