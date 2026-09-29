/**
 * #1311: on a 402pt phone a nested submenu that fit neither side of its
 * parent's row slid over that row and hid its label's first letters
 * ("Image" read "nage"). Under `shrinkTo` it narrows to the room beside the
 * row instead, and the natural width it decides from is latched
 * (`naturalSize`) so the narrowed measurement does not un-narrow it.
 */
import { describe, expect, it } from 'vitest';
import { computeAnchorPosition, computeFramedPosition, naturalSize } from '../src/behaviors/position';

const viewport = { width: 402, height: 874 };
const panel = { width: 208, height: 120 };
const SUB = { placement: 'right-start', offset: 0, shift: true, shrinkTo: 128 } as const;

describe('computeAnchorPosition — shrinkTo (#1311)', () => {
    it('a first-level submenu narrows to the room right of its row instead of covering the root', () => {
        // The Export row inside a root popup at the left edge.
        const row = { top: 100, left: 20, right: 211, bottom: 136, width: 191, height: 36 };
        const p = computeAnchorPosition(row, panel, viewport, SUB);
        expect(p.placement).toBe('right-start');
        expect(p.left).toBe(211);
        expect(p.width).toBe(402 - 8 - 211);
        expect(p.left + p.width!).toBeLessThanOrEqual(402 - 8);
    });

    it('a nested submenu flips to the roomier side and ends at its row, clear of the label', () => {
        // The Image row of a parent submenu against the trailing edge.
        const row = { top: 160, left: 194, right: 386, bottom: 196, width: 192, height: 36 };
        const p = computeAnchorPosition(row, panel, viewport, SUB);
        expect(p.placement).toBe('left-start');
        expect(p.width).toBe(186);
        expect(p.left).toBe(8);
        // No overlap with the row (the label starts inside the row's padding).
        expect(p.left + p.width!).toBe(row.left);
    });

    it('floors a fractional room so the whole-pixel box never reaches past it', () => {
        const row = { top: 160, left: 194.67, right: 386.33, bottom: 196, width: 191.66, height: 36 };
        const p = computeAnchorPosition(row, panel, viewport, SUB);
        expect(p.width).toBe(186);
        expect(p.left + p.width!).toBeLessThanOrEqual(row.left);
        expect(p.left).toBeGreaterThanOrEqual(8);
    });

    it('below the floor it slides over the anchor as before', () => {
        const row = { top: 160, left: 194, right: 386, bottom: 196, width: 192, height: 36 };
        const p = computeAnchorPosition(row, panel, viewport, { ...SUB, shrinkTo: 200 });
        expect(p.placement).toBe('left-start');
        expect(p.width).toBeUndefined();
        expect(p.left).toBe(8);
    });

    it('a popup that fits keeps its own width', () => {
        const row = { top: 100, left: 20, right: 150, bottom: 136, width: 130, height: 36 };
        const p = computeAnchorPosition(row, panel, viewport, SUB);
        expect(p.width).toBeUndefined();
        expect(p.left).toBe(150);
    });

    it('never narrows a top/bottom popup, and never without shift', () => {
        const row = { top: 100, left: 20, right: 211, bottom: 136, width: 191, height: 36 };
        expect(computeAnchorPosition(row, { width: 208, height: 900 }, viewport, { ...SUB, placement: 'bottom-start' }).width).toBeUndefined();
        expect(computeAnchorPosition(row, panel, viewport, { ...SUB, shift: false }).width).toBeUndefined();
    });

    it('survives the safe-frame shift (computeFramedPosition keeps the width)', () => {
        const outlet = { top: 0, left: 0, right: 402, bottom: 874, width: 402, height: 874 };
        const frame = { top: 62, left: 0, right: 402, bottom: 840, width: 402, height: 778 };
        const row = { top: 160, left: 194, right: 386, bottom: 196, width: 192, height: 36 };
        const p = computeFramedPosition(row, panel, outlet, frame, viewport, SUB);
        expect(p.width).toBe(186);
        expect(p.left + p.width!).toBe(row.left);
    });
});

describe('naturalSize', () => {
    it('holds the widest width since reset, with the current height', () => {
        const n = naturalSize();
        expect(n.read(null)).toBeNull();
        expect(n.read({ width: 208, height: 120 })).toEqual({ width: 208, height: 120 });
        // The narrowed measurement does not replace the natural width…
        expect(n.read({ width: 186, height: 132 })).toEqual({ width: 208, height: 132 });
        // …so the placement stays narrowed on the next pass (no oscillation).
        const row = { top: 160, left: 194, right: 386, bottom: 196, width: 192, height: 36 };
        expect(computeAnchorPosition(row, n.read({ width: 186, height: 132 })!, viewport, SUB).width).toBe(186);
        n.reset();
        expect(n.read({ width: 150, height: 90 })).toEqual({ width: 150, height: 90 });
    });
});
