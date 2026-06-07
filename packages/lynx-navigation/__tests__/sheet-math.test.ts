/**
 * Pure sheet math — snap↔progress mapping and release decisions. The drag
 * worklet itself is MT-only (not runnable under lynx-testing); everything
 * it decides is delegated to these functions, so locking them down here is
 * the gesture's unit coverage.
 */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SNAP_POINTS,
    DISMISS_VELOCITY,
    initialSnapProgress,
    nearestSnap,
    offsetYToProgress,
    progressToOffsetY,
    resolveSnapPoints,
    shouldDismiss,
    snapToProgress,
} from '../src/internal/sheet-math';

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

    it('dismisses on a fast downward fling regardless of position', () => {
        expect(shouldDismiss(0.9, DISMISS_VELOCITY + 1, minSnapProgress)).toBe(true);
    });

    it('does not dismiss on a fast upward fling', () => {
        expect(shouldDismiss(0.2, -(DISMISS_VELOCITY + 1), minSnapProgress)).toBe(false);
    });

    it('dismisses a slow release dragged well below the lowest detent', () => {
        expect(shouldDismiss(minSnapProgress * 0.4, 0, minSnapProgress)).toBe(true);
    });

    it('keeps a slow release near the lowest detent', () => {
        expect(shouldDismiss(minSnapProgress * 0.8, 0, minSnapProgress)).toBe(false);
    });
});

describe('nearestSnap', () => {
    const snaps = [0.444, 1] as const; // progresses of fractions [0.4, 0.9]

    it('picks the nearest detent on a slow release', () => {
        expect(nearestSnap(0.5, 0, snaps)).toBeCloseTo(0.444);
        expect(nearestSnap(0.9, 0, snaps)).toBe(1);
    });

    it('a fast downward fling skips to the next detent below', () => {
        // Released just under fully-open but flung down → lower detent,
        // even though 1 is nearer.
        expect(nearestSnap(0.95, DISMISS_VELOCITY + 1, snaps)).toBeCloseTo(0.444);
    });

    it('a fast upward fling skips to the next detent above', () => {
        expect(nearestSnap(0.5, -(DISMISS_VELOCITY + 1), snaps)).toBe(1);
    });

    it('a fling with no detent in its direction stays at the boundary detent', () => {
        // Below the lowest detent, flung down: lowest detent (dismissal is
        // shouldDismiss's call, not nearestSnap's).
        expect(nearestSnap(0.2, DISMISS_VELOCITY + 1, snaps)).toBeCloseTo(0.444);
        expect(nearestSnap(1, -(DISMISS_VELOCITY + 1), snaps)).toBe(1);
    });

    it('returns the input when there are no snap points', () => {
        expect(nearestSnap(0.3, 0, [])).toBe(0.3);
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
