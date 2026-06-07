/**
 * Pure sheet math — snap↔progress mapping and release decisions. The drag
 * worklet itself is MT-only (not runnable under lynx-testing); everything
 * it decides is delegated to these functions, so locking them down here is
 * the gesture's unit coverage.
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SNAP_POINTS,
    initialSnapProgress,
    nearestSnap,
    offsetYToProgress,
    progressToOffsetY,
    resolveSnapPoints,
    SHEET_MIN_DURATION_SEC,
    sheetDurationSec,
    shouldDismiss,
    snapToProgress,
} from '../src/internal/sheet-math';

describe('sheetDurationSec', () => {
    const FULL = 0.28; // modal/card full-screen slide duration

    it('matches the full slide duration at full-height travel', () => {
        expect(sheetDurationSec(1, FULL)).toBe(FULL);
    });

    it('scales by the height fraction traveled (velocity matching)', () => {
        // A 0.9-detent sheet travels 90% of the screen → 90% of the time.
        expect(sheetDurationSec(0.9, FULL)).toBeCloseTo(0.252);
    });

    it('floors low detents so they still read as an animation', () => {
        // 0.4 detent of a [0.4] config: 0.28 * 0.16 ≈ 0.045 → floored.
        expect(sheetDurationSec(0.16, FULL)).toBe(SHEET_MIN_DURATION_SEC);
    });

    it('clamps out-of-range height fractions', () => {
        expect(sheetDurationSec(1.5, FULL)).toBe(FULL);
        expect(sheetDurationSec(-0.2, FULL)).toBe(SHEET_MIN_DURATION_SEC);
    });
});

describe('snapToProgress / progressToOffsetY', () => {
    it('maps the largest snap fraction to progress 1', () => {
        expect(snapToProgress(0.9, 0.9)).toBe(1);
    });

    it('maps a lower snap proportionally', () => {
        expect(snapToProgress(0.45, 0.9)).toBeCloseTo(0.5);
    });

    it('clamps and tolerates a zero max fraction', () => {
        expect(snapToProgress(1.2, 0.9)).toBe(1);
        expect(snapToProgress(0.5, 0)).toBe(0);
    });

    it('progress 0 is off-screen, progress 1 is the fully-open offset', () => {
        expect(progressToOffsetY(0, 0.9, 800)).toBe(800);
        expect(progressToOffsetY(1, 0.9, 800)).toBeCloseTo(80);
    });

    it('round-trips through offsetYToProgress', () => {
        const offset = progressToOffsetY(0.37, 0.8, 800);
        expect(offsetYToProgress(offset, 0.8, 800)).toBeCloseTo(0.37);
    });

    it('a snap fraction lands at its own height fraction', () => {
        // Snap 0.4 of an 800px screen → sheet top at 480px (60% down).
        const p = snapToProgress(0.4, 0.9);
        expect(progressToOffsetY(p, 0.9, 800)).toBeCloseTo(480);
    });
});

describe('shouldDismiss', () => {
    const minSnapProgress = snapToProgress(0.4, 0.9); // ≈ 0.444
    const TRAVEL = 720; // px of full progress travel (0.9 * 800)

    it('dismisses on a fast downward fling regardless of position', () => {
        // 3000 px/s projects 3000*0.2/720 ≈ 0.83 of progress downward.
        expect(shouldDismiss(0.9, 3000, minSnapProgress, TRAVEL)).toBe(true);
    });

    it('does not dismiss on a fast upward fling from a low position', () => {
        expect(shouldDismiss(0.2, -1500, minSnapProgress, TRAVEL)).toBe(false);
    });

    it('does NOT dismiss a controlled downward drag aimed at the lower detent', () => {
        // The on-device repro: released at 0.6 progress moving ~360 px/s
        // down — projects to ≈0.5, well above the dismiss line. The old
        // raw velocity threshold (300 px/s) misread this as a fling.
        expect(shouldDismiss(0.6, 360, minSnapProgress, TRAVEL)).toBe(false);
    });

    it('dismisses a slow release dragged well below the lowest detent', () => {
        expect(shouldDismiss(minSnapProgress * 0.4, 0, minSnapProgress, TRAVEL)).toBe(true);
    });

    it('keeps a slow release near the lowest detent', () => {
        expect(shouldDismiss(minSnapProgress * 0.8, 0, minSnapProgress, TRAVEL)).toBe(false);
    });
});

describe('nearestSnap', () => {
    const snaps = [0.444, 1] as const; // progresses of fractions [0.4, 0.9]
    const TRAVEL = 720;

    it('picks the nearest detent on a slow release', () => {
        expect(nearestSnap(0.5, 0, snaps, TRAVEL)).toBeCloseTo(0.444);
        expect(nearestSnap(0.9, 0, snaps, TRAVEL)).toBe(1);
    });

    it('a fast downward fling projects to the detent below', () => {
        // Released just under fully-open but flung down at 1500 px/s →
        // projects ≈0.42 lower → lower detent, even though 1 is nearer.
        expect(nearestSnap(0.95, 1500, snaps, TRAVEL)).toBeCloseTo(0.444);
    });

    it('a fast upward fling projects to the detent above', () => {
        expect(nearestSnap(0.5, -1500, snaps, TRAVEL)).toBe(1);
    });

    it('a controlled downward drag settles at the detent it aims for', () => {
        // The on-device repro companion: 0.6 progress at ~360 px/s down
        // projects to ≈0.5 → lower detent.
        expect(nearestSnap(0.6, 360, snaps, TRAVEL)).toBeCloseTo(0.444);
    });

    it('a fling past the boundary detent stays at the boundary detent', () => {
        expect(nearestSnap(0.2, 1500, snaps, TRAVEL)).toBeCloseTo(0.444);
        expect(nearestSnap(1, -1500, snaps, TRAVEL)).toBe(1);
    });

    it('returns the input when there are no snap points', () => {
        expect(nearestSnap(0.3, 0, [], TRAVEL)).toBe(0.3);
    });
});

describe('resolveSnapPoints / initialSnapProgress', () => {
    it('sorts declared fractions ascending and drops invalid ones', () => {
        expect(resolveSnapPoints([0.9, 0.4, 0, 1.5])).toEqual([0.4, 0.9]);
    });

    it('falls back to the default when nothing valid is declared', () => {
        expect(resolveSnapPoints(undefined)).toBe(DEFAULT_SNAP_POINTS);
        expect(resolveSnapPoints([])).toBe(DEFAULT_SNAP_POINTS);
    });

    it('defaults the initial snap to the most-open detent', () => {
        expect(initialSnapProgress([0.4, 0.9], undefined)).toBe(1);
    });

    it('honors a valid initialSnapIndex', () => {
        expect(initialSnapProgress([0.4, 0.9], 0)).toBeCloseTo(0.444, 3);
    });

    it('ignores an out-of-range initialSnapIndex', () => {
        expect(initialSnapProgress([0.4, 0.9], 5)).toBe(1);
    });
});
