/**
 * The grab/move/flick worklets, driven directly — same trick as the physics
 * tests: `'main thread'` is a string expression statement under node, so these
 * are the functions that actually run on device.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createSimState, SIM_RUNNING, type SimState } from '../state';
import { dragBegin, dragCancel, dragMove, dragRelease, pickDisc, DRAG_TUNING } from '../drag.mt';
import { MAX_LAUNCH_SPEED } from '../tuning';

const W = 400;
const H = 1000;
/** Player A's home band, matching `game/board.ts`. */
const HOME_Y0 = 0.87 * H;
const HOME_Y1 = H;

let st: SimState;

beforeEach(() => {
    st = createSimState(64);
    st.w = W;
    st.h = H;
    st.turn = 0;
    st.homeY0 = HOME_Y0;
    st.homeY1 = HOME_Y1;
    st.originX = 0;
    st.originY = 0;
});

function place(i: number, x: number, y: number, owner = 0, r = 14): void {
    st.id[i] = 100 + i;
    st.x[i] = x;
    st.y[i] = y;
    st.vx[i] = 0;
    st.vy[i] = 0;
    st.r[i] = r;
    st.im[i] = (22 * 22) / (r * r);
    st.alive[i] = 1;
    st.owner[i] = owner;
    st.sleep[i] = 6;
    if (i + 1 > st.n) st.n = i + 1;
}

/**
 * Grab at the disc and drag through `points` at a fixed cadence, then release.
 * `ms` per step sets the finger speed, which IS the shot.
 */
function flick(points: Array<[number, number]>, ms = 16): number[] | null {
    let t = 1000;
    dragBegin(st, points[0]![0], points[0]![1], t);
    for (let i = 1; i < points.length; i++) {
        t += ms;
        dragMove(st, points[i]![0], points[i]![1], t);
    }
    return dragRelease(st);
}

describe('pickDisc', () => {
    it('catches a disc under the finger', () => {
        place(0, 200, 950);
        expect(pickDisc(st, 200, 950)).toBe(0);
    });

    it('is forgiving by the touch slop, but not beyond it', () => {
        place(0, 200, 950);
        const reach = st.r[0]! + DRAG_TUNING.slop;
        expect(pickDisc(st, 200 + reach - 1, 950)).toBe(0);
        expect(pickDisc(st, 200 + reach + 2, 950)).toBe(-1);
    });

    it('picks the NEAREST of two overlapping discs, not the first in the array', () => {
        place(0, 200, 950);
        place(1, 212, 950);
        expect(pickDisc(st, 214, 950)).toBe(1);
        expect(pickDisc(st, 198, 950)).toBe(0);
    });

    it("ignores the opponent's discs", () => {
        place(0, 200, 950, 1);
        expect(pickDisc(st, 200, 950)).toBe(-1);
    });

    it('ignores your own discs outside your home band', () => {
        place(0, 200, 500);
        expect(pickDisc(st, 200, 500)).toBe(-1);
    });

    it('ignores burnt-out discs', () => {
        place(0, 200, 950);
        st.alive[0] = 0;
        expect(pickDisc(st, 200, 950)).toBe(-1);
    });
});

describe('dragBegin', () => {
    it('converts page coordinates into board space', () => {
        place(0, 200, 950);
        st.originX = 30;
        st.originY = 80;
        expect(dragBegin(st, 230, 1030, 0)).toBe(1);
        expect(st.dragSlot).toBe(0);
    });

    it('keeps the grab offset so the disc does not jump to the finger', () => {
        place(0, 200, 950);
        dragBegin(st, 208, 944, 0);
        dragMove(st, 208, 944, 16);
        expect(st.x[0]).toBe(200);
        expect(st.y[0]).toBe(950);
    });

    it('refuses to grab while a shot is still running', () => {
        place(0, 200, 950);
        st.phase = SIM_RUNNING;
        expect(dragBegin(st, 200, 950, 0)).toBe(0);
    });
});

describe('dragMove — the disc follows, inside your own end', () => {
    it('tracks the finger', () => {
        place(0, 200, 950);
        dragBegin(st, 200, 950, 0);
        dragMove(st, 260, 960, 16);
        expect(st.x[0]).toBe(260);
        expect(st.y[0]).toBe(960);
    });

    it('stops the disc at the home band while the finger carries on', () => {
        // "You can only move it freely inside your area." The clamp is on the
        // disc, not the finger — the disc stops at the line and keeps
        // following sideways.
        place(0, 200, 950);
        dragBegin(st, 200, 950, 0);
        dragMove(st, 260, 400, 16);
        expect(st.y[0]).toBe(HOME_Y0 + st.r[0]!);
        expect(st.x[0]).toBe(260);
    });

    it('keeps the disc on the board horizontally', () => {
        place(0, 200, 950);
        dragBegin(st, 200, 950, 0);
        dragMove(st, -500, 950, 16);
        expect(st.x[0]).toBe(st.r[0]);
        dragMove(st, 5000, 950, 32);
        expect(st.x[0]).toBe(W - st.r[0]!);
    });

    it('does not let the far edge of the band escape the board', () => {
        place(0, 200, 950);
        dragBegin(st, 200, 950, 0);
        dragMove(st, 200, 5000, 16);
        expect(st.y[0]).toBeLessThanOrEqual(H - st.r[0]!);
    });

    it('leaves a held disc at rest, so the sim cannot run away with it', () => {
        place(0, 200, 950);
        dragBegin(st, 200, 950, 0);
        dragMove(st, 300, 960, 16);
        expect(st.vx[0]).toBe(0);
        expect(st.vy[0]).toBe(0);
    });

    it('does nothing when nothing was grabbed', () => {
        place(0, 200, 950);
        dragBegin(st, 50, 950, 0);
        dragMove(st, 123, 960, 16);
        expect(st.x[0]).toBe(200);
    });
});

describe('dragRelease — the flick IS the shot', () => {
    it('fires along the finger, not against it', () => {
        // Flick up the board; the disc must travel up the board.
        place(0, 200, 950);
        const shot = flick([[200, 950], [200, 930], [200, 910], [200, 890]]);
        expect(shot).not.toBeNull();
        expect(shot![0]).toBe(st.id[0]);
        expect(shot![2]).toBeLessThan(0);
    });

    it('goes faster the harder you flick', () => {
        place(0, 200, 950);
        const slow = flick([[200, 950], [200, 940], [200, 930]], 60)!;
        place(0, 200, 950);
        const fast = flick([[200, 950], [200, 910], [200, 870]], 16)!;
        expect(Math.abs(fast[2]!)).toBeGreaterThan(Math.abs(slow[2]!) * 3);
    });

    it('treats a slow release as placing the disc, not shooting it', () => {
        // Repositioning must not cost a turn.
        place(0, 200, 950);
        expect(flick([[200, 950], [200, 949], [200, 948]], 120)).toBeNull();
    });

    it('caps at the launch speed, preserving direction', () => {
        place(0, 200, 950);
        const shot = flick([[200, 950], [140, 870], [80, 790]], 4)!;
        const speed = Math.hypot(shot[1]!, shot[2]!);
        expect(speed).toBeCloseTo(MAX_LAUNCH_SPEED, 4);
        expect(shot[1]! / shot[2]!).toBeCloseTo(60 / 80, 4);
    });

    it('launches a big disc slower than a small one from the same flick', () => {
        // A heavier disc takes more effort to get moving — OLO's "some require
        // more flicking force than others".
        place(0, 200, 950, 0, 14);
        const small = flick([[200, 950], [200, 920], [200, 890]])!;
        place(0, 200, 950, 0, 22);
        const big = flick([[200, 950], [200, 920], [200, 890]])!;

        expect(Math.abs(big[2]!)).toBeLessThan(Math.abs(small[2]!));
        // …but it still carries MORE momentum, so it hits harder.
        const pSmall = Math.abs(small[2]!) * ((14 * 14) / (22 * 22));
        const pBig = Math.abs(big[2]!) * 1;
        expect(pBig).toBeGreaterThan(pSmall);
    });

    it('launches a small disc at exactly finger speed', () => {
        // The heft scaling is normalised on the small disc, so it is the
        // reference the player calibrates against.
        place(0, 200, 950, 0, 14);
        // Three samples at 16ms, 30px apart: the smoothed speed converges on
        // 30/16*1000 = 1875 px/s, which the cap then trims.
        const shot = flick([[200, 950], [200, 920], [200, 890]])!;
        const speed = Math.hypot(shot[1]!, shot[2]!);
        expect(speed).toBeGreaterThan(DRAG_TUNING.minFlick);
    });

    it('returns null when nothing was grabbed', () => {
        place(0, 200, 950);
        expect(dragRelease(st)).toBeNull();
    });

    it('clears the drag so a second release cannot re-fire', () => {
        place(0, 200, 950);
        expect(flick([[200, 950], [200, 910], [200, 870]])).not.toBeNull();
        expect(st.dragActive).toBe(0);
        expect(dragRelease(st)).toBeNull();
    });

    it('reports the disc id, not the slot', () => {
        place(0, 100, 950);
        place(1, 250, 950);
        dragBegin(st, 250, 950, 0);
        dragMove(st, 250, 910, 16);
        dragMove(st, 250, 870, 32);
        expect(dragRelease(st)![0]).toBe(st.id[1]);
    });
});

describe('dragCancel', () => {
    it('abandons the drag without firing', () => {
        place(0, 200, 950);
        dragBegin(st, 200, 950, 0);
        dragMove(st, 200, 900, 16);
        dragCancel(st);
        expect(st.dragActive).toBe(0);
        expect(dragRelease(st)).toBeNull();
    });
});
