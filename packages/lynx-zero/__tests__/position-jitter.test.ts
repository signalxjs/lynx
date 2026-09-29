/**
 * #1300: a popup centred on its anchor re-measured a third of a point wider
 * or narrower at each fractional `left` on iOS, and every jitter moved it
 * again — a per-frame measure → publish → patch → layout loop that tripped
 * the engine's event limit. The placement input is held (`stickySize`) and
 * the painted offset is whole pixels, so the loop settles.
 */
import { describe, expect, it } from 'vitest';
import type { ElementLayout } from '@sigx/lynx';
import { computeFramedPosition, stickySize } from '../src/behaviors/position';

const outlet: ElementLayout = { top: 0, left: 0, width: 402, height: 874, right: 402, bottom: 874 };
const frame: ElementLayout = { top: 62, left: 0, width: 402, height: 778, right: 402, bottom: 840 };
// The device's Save trigger (points, iPhone 17 Pro).
const anchor: ElementLayout = { left: 167.66666666666666, top: 196, width: 66.66666666666666, height: 48, right: 234.33333333333331, bottom: 244 };
const screen = { width: 402, height: 874 };

describe('stickySize', () => {
    it('holds a size across re-measures within a pixel; takes a real change', () => {
        const read = stickySize();
        const first = read({ width: 135.33, height: 22.33 });
        expect(read({ width: 135.67, height: 22.33 })).toBe(first);
        expect(read({ width: 134.9, height: 22 })).toBe(first);
        expect(read({ width: 140, height: 22.33 })).toEqual({ width: 140, height: 22.33 });
        expect(read(null)).toBeNull();
        expect(read({ width: 135.67, height: 22.33 })).toEqual({ width: 135.67, height: 22.33 });
    });
});

describe('anchored popup under sub-pixel layout snapping (#1300)', () => {
    /** The device trace: at left 133.17 the popup paints 135.33 wide, at 133.33 it paints 135.67. */
    const snappedWidth = (left: number): number => (left - Math.floor(left) < 0.25 ? 135.33333333333331 : 135.66666666666663);

    const run = (withFix: boolean): number => {
        const held = stickySize();
        let width = 135.66666666666606;
        let painted = '';
        let patches = 0;
        for (let frameNo = 0; frameNo < 200; frameNo++) {
            const size = withFix ? held({ width, height: 22.333333333333343 })! : { width, height: 22.333333333333343 };
            const p = computeFramedPosition(anchor, size, outlet, frame, screen, { placement: 'top', offset: 8 });
            const left = withFix ? Math.round(p.left) : p.left;
            const style = `${left}px`;
            if (style === painted) break;
            painted = style;
            patches++;
            width = snappedWidth(left);
        }
        return patches;
    };

    it('without the hold and whole pixels, the loop never settles (negative control)', () => {
        expect(run(false)).toBe(200);
    });

    it('settles in at most two patches', () => {
        expect(run(true)).toBeLessThanOrEqual(2);
    });
});
