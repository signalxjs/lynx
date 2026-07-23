/**
 * Pure reveal-px math — release decisions and durations. The drag worklets
 * themselves are MT-only (not runnable under lynx-testing); everything
 * they decide is delegated to these functions, so locking them down here
 * is the gesture's unit coverage. Ports lynx-navigation's
 * `sheet-math.test.ts` scenarios from progress space to px space.
 */
import { describe, expect, it } from 'vitest';
import {
    nearestDetentIndex,
    projectReveal,
    REVEAL_MIN_DURATION_SEC,
    revealDurationSec,
    shouldDismiss,
} from '../src/math';

describe('revealDurationSec', () => {
    const FULL = 0.28; // modal/card full-screen slide duration

    it('matches the full slide duration at full-height travel', () => {
        expect(revealDurationSec(1, FULL)).toBe(FULL);
    });

    it('scales by the height fraction traveled (velocity matching)', () => {
        // A 0.9-detent sheet travels 90% of the screen → 90% of the time.
        expect(revealDurationSec(0.9, FULL)).toBeCloseTo(0.252);
    });

    it('floors low detents so they still read as an animation', () => {
        // A 0.4-fraction travel: 0.28 * 0.4 = 0.112 → floored.
        expect(revealDurationSec(0.4, FULL)).toBe(REVEAL_MIN_DURATION_SEC);
    });

    it('clamps out-of-range height fractions', () => {
        expect(revealDurationSec(1.5, FULL)).toBe(FULL);
        expect(revealDurationSec(-0.2, FULL)).toBe(REVEAL_MIN_DURATION_SEC);
    });

    it('never exceeds the full slide duration, even below the floor', () => {
        expect(revealDurationSec(1, 0.1)).toBe(0.1);
    });
});

describe('projectReveal / shouldDismiss', () => {
    // A [320, 720] sheet on an 800px screen: floor detent at 320px.
    const FLOOR = 320;

    it('projects downward velocity into a lower landing reveal', () => {
        // 1000 px/s down for PROJECTION_SEC (0.2s) = 200px lower.
        expect(projectReveal(600, 1000)).toBe(400);
        expect(projectReveal(600, -1000)).toBe(800);
    });

    it('dismisses on a fast downward fling regardless of position', () => {
        // 3000 px/s projects 600px downward — from 700px that lands at
        // 100px, under the 160px dismiss line.
        expect(shouldDismiss(700, 3000, FLOOR)).toBe(true);
    });

    it('does not dismiss on a fast upward fling from a low position', () => {
        expect(shouldDismiss(150, -1500, FLOOR)).toBe(false);
    });

    it('does NOT dismiss a controlled downward drag aimed at the floor', () => {
        // The on-device repro: released at 430px moving ~360 px/s down —
        // projects to ≈358px, well above the 160px dismiss line. The old
        // raw velocity threshold (300 px/s) misread this as a fling.
        expect(shouldDismiss(430, 360, FLOOR)).toBe(false);
    });

    it('dismisses a slow release dragged well below the floor', () => {
        expect(shouldDismiss(FLOOR * 0.4, 0, FLOOR)).toBe(true);
    });

    it('keeps a slow release near the floor', () => {
        expect(shouldDismiss(FLOOR * 0.8, 0, FLOOR)).toBe(false);
    });
});

describe('nearestDetentIndex', () => {
    const DETENTS = [320, 720] as const;

    it('picks the nearest detent on a slow release', () => {
        expect(nearestDetentIndex(360, 0, DETENTS)).toBe(0);
        expect(nearestDetentIndex(650, 0, DETENTS)).toBe(1);
    });

    it('a fast downward fling projects to the detent below', () => {
        // Released just under fully-open but flung down at 1500 px/s →
        // projects 300px lower → floor detent, even though 720 is nearer.
        expect(nearestDetentIndex(680, 1500, DETENTS)).toBe(0);
    });

    it('a fast upward fling projects to the detent above', () => {
        expect(nearestDetentIndex(400, -1500, DETENTS)).toBe(1);
    });

    it('a controlled downward drag settles at the detent it aims for', () => {
        // The on-device repro companion: 430px at ~360 px/s down projects
        // to ≈358px → floor detent.
        expect(nearestDetentIndex(430, 360, DETENTS)).toBe(0);
    });

    it('a fling past the boundary detent stays at the boundary detent', () => {
        expect(nearestDetentIndex(150, 1500, DETENTS)).toBe(0);
        expect(nearestDetentIndex(720, -1500, DETENTS)).toBe(1);
    });

    it('returns -1 when there are no candidates', () => {
        expect(nearestDetentIndex(300, 0, [])).toBe(-1);
    });
});
