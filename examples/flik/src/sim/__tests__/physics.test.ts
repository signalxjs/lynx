/**
 * The real physics worklets, driven directly.
 *
 * `'main thread'` is just a string expression statement in node, so these
 * import the exact functions that run on device rather than a copy — there is
 * no second implementation to drift.
 *
 * The tuning constants are inlined into the worklet bodies (a worklet can't
 * reach a module-scope binding at runtime), so the first test asserts the
 * inlined values still match `tuning.ts`. Without it, the documented tuning
 * and the actual tuning could silently diverge.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createSimState, SIM_RUNNING, SIM_SETTLED, type SimState } from '../state';
import { integrateStep } from '../integrate.mt';
import { emitPairs } from '../broadphase.mt';
import { resolvePairs } from '../collide.mt';
import { stepWorld } from '../tick.mt';
import { applyWorld, kickAll, launch, slotOf } from '../world.mt';
import {
    CORRECTION,
    DRAG,
    FRICTION,
    MAX_LAUNCH_SPEED,
    RESTITUTION,
    SLEEP_FRAMES,
    SLEEP_SPEED,
    WALL_BOUNCE,
} from '../tuning';

const W = 400;
const H = 1000;

let st: SimState;

beforeEach(() => {
    st = createSimState(64);
    st.w = W;
    st.h = H;
    st.broadphase = 0;
});

/** Put a disc in slot `i`. Radius 14 unless told otherwise; mass from area. */
function place(
    i: number,
    x: number,
    y: number,
    vx = 0,
    vy = 0,
    r = 14,
): void {
    st.id[i] = i;
    st.x[i] = x;
    st.y[i] = y;
    st.vx[i] = vx;
    st.vy[i] = vy;
    st.r[i] = r;
    st.im[i] = (22 * 22) / (r * r);
    st.alive[i] = 1;
    st.sleep[i] = 0;
    st.owner[i] = 0;
    if (i + 1 > st.n) st.n = i + 1;
}

function speedOf(i: number): number {
    return Math.hypot(st.vx[i]!, st.vy[i]!);
}

describe('tuning constants match the values inlined in the worklets', () => {
    it('friction decelerates at FRICTION px/s²', () => {
        place(0, 200, 500, 300, 0);
        integrateStep(st, 0.1);
        // Coulomb first, then the viscous term.
        const expected = (300 - FRICTION * 0.1) * (1 - DRAG * 0.1);
        expect(st.vx[0]).toBeCloseTo(expected, 4);
    });

    it('walls rebound at WALL_BOUNCE', () => {
        // Close enough that one step at this speed crosses the wall: r=14 and
        // the step covers ~3.25px.
        place(0, 16, 500, -400, 0);
        integrateStep(st, 1 / 120);
        expect(st.vx[0]).toBeGreaterThan(0);
        // Speed after the bounce, backing out the friction applied first.
        const afterFriction = (400 - FRICTION / 120) * (1 - DRAG / 120);
        expect(st.vx[0]).toBeCloseTo(afterFriction * WALL_BOUNCE, 3);
    });

    it('sleeps after SLEEP_FRAMES steps below SLEEP_SPEED', () => {
        // `awake` is a product of the last step, so it means nothing until one
        // has run — hence the step-then-assert ordering.
        place(0, 200, 500, SLEEP_SPEED - 1, 0);
        for (let k = 0; k < SLEEP_FRAMES - 1; k++) {
            integrateStep(st, 1 / 120);
            expect(st.awake).toBe(1);
        }
        integrateStep(st, 1 / 120);
        expect(st.awake).toBe(0);
    });

    it('resolves CORRECTION of an overlap per substep', () => {
        // Equal masses, so each moves half of the corrected amount.
        place(0, 200, 500);
        place(1, 200 + 20, 500); // 8px of overlap on 28px diameter
        emitPairs(st);
        resolvePairs(st);
        const gap = st.x[1]! - st.x[0]!;
        expect(gap).toBeCloseTo(20 + 8 * CORRECTION, 4);
    });
});

describe('integrateStep', () => {
    it('brings a slow disc to a dead stop rather than reversing it', () => {
        // Below one step's worth of Coulomb friction: the disc must stop, not
        // get pushed backwards.
        place(0, 200, 500, 2, 0);
        integrateStep(st, 0.1);
        expect(st.vx[0]).toBe(0);
        expect(st.vy[0]).toBe(0);
    });

    it('keeps every disc inside the board, even from outside it', () => {
        place(0, -50, -80, -900, -900);
        place(1, W + 50, H + 80, 900, 900);
        for (let k = 0; k < 20; k++) integrateStep(st, 1 / 120);

        for (const i of [0, 1]) {
            expect(st.x[i]).toBeGreaterThanOrEqual(st.r[i]! - 1e-6);
            expect(st.x[i]).toBeLessThanOrEqual(W - st.r[i]! + 1e-6);
            expect(st.y[i]).toBeGreaterThanOrEqual(st.r[i]! - 1e-6);
            expect(st.y[i]).toBeLessThanOrEqual(H - st.r[i]! + 1e-6);
        }
    });

    it('loses energy on every wall bounce, so a disc always comes to rest', () => {
        place(0, 200, 500, 1500, 700);
        for (let k = 0; k < 4000; k++) integrateStep(st, 1 / 120);
        expect(speedOf(0)).toBe(0);
    });

    it('wakes a sleeping disc that hits a wall', () => {
        // A disc marked asleep but carrying real speed — what happens when one
        // gets knocked into the cushion.
        place(0, 16, 500, -400, 0);
        st.sleep[0] = SLEEP_FRAMES;
        integrateStep(st, 1 / 120);
        expect(st.sleep[0]).toBe(0);
        expect(st.awake).toBe(1);
    });

    it('skips dead discs entirely', () => {
        place(0, 200, 500, 500, 0);
        st.alive[0] = 0;
        integrateStep(st, 1 / 120);
        expect(st.x[0]).toBe(200);
        expect(st.awake).toBe(0);
    });
});

describe('collisions', () => {
    it('transfers momentum head-on between equal discs', () => {
        place(0, 200, 480, 0, 400);
        place(1, 200, 480 + 26, 0, 0);
        emitPairs(st);
        resolvePairs(st);

        expect(st.vy[0]).toBeLessThan(400);
        expect(st.vy[1]).toBeGreaterThan(0);
        expect(st.contacts).toBe(1);
    });

    it('lets a big disc shove a small one much harder than it recoils', () => {
        // This is the entire reason FLIK has two disc sizes.
        place(0, 200, 480, 0, 400, 22);
        place(1, 200, 480 + 34, 0, 0, 14);
        emitPairs(st);
        resolvePairs(st);

        const bigSpeed = Math.abs(st.vy[0]!);
        const smallSpeed = Math.abs(st.vy[1]!);
        expect(smallSpeed).toBeGreaterThan(bigSpeed * 2);
    });

    it('conserves momentum along the collision normal', () => {
        const m = (i: number): number => 1 / st.im[i]!;
        place(0, 200, 480, 0, 400, 22);
        place(1, 200, 480 + 34, 0, -100, 14);
        const before = m(0) * st.vy[0]! + m(1) * st.vy[1]!;

        emitPairs(st);
        resolvePairs(st);

        expect(m(0) * st.vy[0]! + m(1) * st.vy[1]!).toBeCloseTo(before, 6);
    });

    it('separates discs that overlap without any relative velocity', () => {
        place(0, 200, 500);
        place(1, 205, 500);
        for (let k = 0; k < 40; k++) {
            emitPairs(st);
            resolvePairs(st);
        }
        expect(Math.abs(st.x[1]! - st.x[0]!)).toBeGreaterThanOrEqual(28 - 0.5);
    });

    it('never pushes a disc out of the board while separating a jam', () => {
        // Resolution runs AFTER integrateStep's wall clamp in each substep,
        // so a pile pressed against a cushion has nowhere to be pushed but
        // outwards — and on the substep that reaches quiescence there is no
        // next integration to pull it back. Observed on device as discs
        // clipped through the right wall.
        st.n = 0;
        for (let i = 0; i < 4; i++) place(i, W - 20 - i * 6, 500);

        emitPairs(st);
        resolvePairs(st);

        for (let i = 0; i < st.n; i++) {
            expect(st.x[i]).toBeLessThanOrEqual(W - st.r[i]! + 1e-6);
            expect(st.x[i]).toBeGreaterThanOrEqual(st.r[i]! - 1e-6);
        }
    });

    it('keeps a corner pile inside both walls at once', () => {
        st.n = 0;
        for (let i = 0; i < 4; i++) place(i, W - 18 - i * 5, H - 18 - i * 5);

        emitPairs(st);
        resolvePairs(st);

        for (let i = 0; i < st.n; i++) {
            expect(st.x[i]).toBeLessThanOrEqual(W - st.r[i]! + 1e-6);
            expect(st.y[i]).toBeLessThanOrEqual(H - st.r[i]! + 1e-6);
        }
    });

    it('survives exactly concentric discs rather than dividing by zero', () => {
        place(0, 200, 500);
        place(1, 200, 500);
        emitPairs(st);
        resolvePairs(st);
        expect(Number.isFinite(st.x[0]!)).toBe(true);
        expect(Number.isFinite(st.x[1]!)).toBe(true);
        expect(st.x[0]).not.toBe(st.x[1]);
    });

    it('does not re-impulse a pair that is already separating', () => {
        // Overlap resolves over several substeps; impulsing on each one would
        // pump energy in and the pair would fly apart.
        place(0, 200, 500, 0, -100);
        place(1, 200, 520, 0, 100);
        emitPairs(st);
        resolvePairs(st);
        expect(st.vy[0]).toBe(-100);
        expect(st.vy[1]).toBe(100);
        expect(st.contacts).toBe(0);
    });

    it('leaves discs that are not touching alone', () => {
        place(0, 100, 500);
        place(1, 300, 500);
        emitPairs(st);
        resolvePairs(st);
        expect(st.contacts).toBe(0);
        expect(st.x[0]).toBe(100);
    });

    it('records the largest impulse for the haptic', () => {
        place(0, 200, 480, 0, 600);
        place(1, 200, 480 + 26, 0, -600);
        emitPairs(st);
        resolvePairs(st);
        expect(st.bigHit).toBeGreaterThan(0);
    });
});

describe('broadphase', () => {
    /** Every colliding pair, by brute force, as `"i-j"`. */
    function trueOverlaps(): Set<string> {
        const out = new Set<string>();
        for (let i = 0; i < st.n; i++) {
            for (let j = i + 1; j < st.n; j++) {
                if (!st.alive[i] || !st.alive[j]) continue;
                const dx = st.x[j]! - st.x[i]!;
                const dy = st.y[j]! - st.y[i]!;
                const sum = st.r[i]! + st.r[j]!;
                if (dx * dx + dy * dy < sum * sum) out.add(`${i}-${j}`);
            }
        }
        return out;
    }

    function emitted(): Set<string> {
        const out = new Set<string>();
        for (let p = 0; p < st.np; p++) {
            const a = Math.min(st.pi[p]!, st.pj[p]!);
            const b = Math.max(st.pi[p]!, st.pj[p]!);
            out.add(`${a}-${b}`);
        }
        return out;
    }

    it('emits every pair exactly once in all-pairs mode', () => {
        for (let i = 0; i < 8; i++) place(i, 50 + i * 40, 500);
        st.broadphase = 0;
        emitPairs(st);
        expect(st.np).toBe((8 * 7) / 2);
        expect(emitted().size).toBe(st.np);
    });

    it('the grid finds every real overlap the brute force does', () => {
        // The correctness property that matters: the grid may emit extra
        // candidates, but it must never MISS a touching pair.
        st.n = 0;
        for (let i = 0; i < 40; i++) {
            const h = (i * 2654435761) % 9973;
            place(i, 20 + (h % 360), 20 + ((h * 7) % 960), 0, 0, i % 4 === 0 ? 22 : 14);
        }
        st.cell = 44;
        st.cols = Math.ceil(W / 44);
        st.rows = Math.ceil(H / 44);
        st.head.length = st.cols * st.rows;

        st.broadphase = 1;
        emitPairs(st);
        const grid = emitted();

        for (const pair of trueOverlaps()) {
            expect(grid.has(pair)).toBe(true);
        }
    });

    it('the grid never emits the same pair twice', () => {
        st.n = 0;
        for (let i = 0; i < 30; i++) place(i, 40 + (i % 6) * 55, 100 + Math.floor(i / 6) * 50);
        st.cell = 28;
        st.cols = Math.ceil(W / 28);
        st.rows = Math.ceil(H / 28);
        st.head.length = st.cols * st.rows;

        st.broadphase = 1;
        emitPairs(st);
        expect(emitted().size).toBe(st.np);
    });

    it('is far cheaper than all-pairs at scale', () => {
        st.n = 0;
        for (let i = 0; i < 60; i++) {
            const h = (i * 2654435761) % 9973;
            place(i, 20 + (h % 360), 20 + ((h * 7) % 960));
        }
        st.cell = 28;
        st.cols = Math.ceil(W / 28);
        st.rows = Math.ceil(H / 28);
        st.head.length = st.cols * st.rows;

        st.broadphase = 0;
        emitPairs(st);
        const naive = st.np;

        st.broadphase = 1;
        emitPairs(st);
        expect(st.np).toBeLessThan(naive / 4);
    });

    it('stops at the buffer cap rather than growing it mid-frame', () => {
        const small = createSimState(64, 10);
        small.w = W;
        small.h = H;
        small.broadphase = 0;
        st = small;
        for (let i = 0; i < 20; i++) place(i, 50 + i * 15, 500);

        emitPairs(st);
        expect(st.np).toBe(10);
        expect(st.pi.length).toBe(10);
    });
});

describe('stepWorld', () => {
    beforeEach(() => {
        st.phase = SIM_RUNNING;
    });

    it('does nothing unless the simulation is running', () => {
        place(0, 200, 500, 400, 0);
        st.phase = 0;
        expect(stepWorld(st, 1 / 60)).toBe(0);
        expect(st.x[0]).toBe(200);
    });

    it('is deterministic for a given sequence of frame deltas', () => {
        const run = (): number[] => {
            const s = createSimState(8);
            s.w = W;
            s.h = H;
            s.broadphase = 0;
            s.phase = SIM_RUNNING;
            st = s;
            place(0, 120, 500, 700, 260);
            place(1, 240, 520, -300, 100);
            for (let k = 0; k < 120; k++) stepWorld(s, 1 / 60);
            return [s.x[0]!, s.y[0]!, s.x[1]!, s.y[1]!];
        };
        expect(run()).toEqual(run());
    });

    it('reports settled exactly once, then packs id/x/y', () => {
        place(0, 200, 500, 30, 0);
        let settles = 0;
        for (let k = 0; k < 400; k++) settles += stepWorld(st, 1 / 60);

        expect(settles).toBe(1);
        expect(st.phase).toBe(SIM_SETTLED);
        expect(st.packed).toHaveLength(3);
        expect(st.packed[0]).toBe(st.id[0]);
        expect(st.packed[1]).toBeCloseTo(st.x[0]!, 2);
    });

    it('packs the disc id, not the slot index', () => {
        place(0, 200, 500, 30, 0);
        st.id[0] = 77;
        for (let k = 0; k < 400; k++) stepWorld(st, 1 / 60);
        expect(st.packed[0]).toBe(77);
    });

    it('omits dead discs from the settle payload', () => {
        place(0, 200, 500, 30, 0);
        place(1, 100, 300);
        st.alive[1] = 0;
        for (let k = 0; k < 400; k++) stepWorld(st, 1 / 60);
        expect(st.packed).toHaveLength(3);
    });

    it('drops the backlog instead of spiralling after a long frame', () => {
        place(0, 200, 500, 400, 0);
        stepWorld(st, 2.0);
        // A two-second gap is ~240 substeps of debt. Carrying it would put
        // the next frame even further behind, forever.
        expect(st.acc).toBe(0);
    });

    it('does not tunnel a disc through a wall at the launch cap', () => {
        place(0, 200, 40, 0, -MAX_LAUNCH_SPEED);
        for (let k = 0; k < 30; k++) stepWorld(st, 1 / 60);
        expect(st.y[0]).toBeGreaterThanOrEqual(st.r[0]!);
    });

    it('does not let two discs pass through each other head-on at speed', () => {
        place(0, 200, 300, 0, MAX_LAUNCH_SPEED);
        place(1, 200, 700, 0, -MAX_LAUNCH_SPEED);
        for (let k = 0; k < 40; k++) stepWorld(st, 1 / 60);
        // Whatever else happened, 0 must not have ended up past 1.
        expect(st.y[0]).toBeLessThan(st.y[1]!);
    });

    it('leaves every disc inside the board at the moment it settles', () => {
        // The invariant has to hold at QUIESCENCE, not just after an
        // integration: collision resolution runs after the wall clamp in each
        // substep, so a pair separating against a cushion can be shoved
        // outside — and on the substep that settles, there is no next
        // integration to pull it back. Found on device as two discs clipped
        // through the right wall.
        st.n = 0;
        // A tight column jammed into the right cushion: correction has
        // nowhere to push them but outwards.
        for (let i = 0; i < 6; i++) place(i, W - 16, 400 + i * 20, 600, 0);
        st.phase = SIM_RUNNING;

        let settled = 0;
        for (let k = 0; k < 3000 && settled === 0; k++) settled = stepWorld(st, 1 / 60);
        expect(settled).toBe(1);

        for (let i = 0; i < st.n; i++) {
            expect(st.x[i]).toBeGreaterThanOrEqual(st.r[i]! - 1e-6);
            expect(st.x[i]).toBeLessThanOrEqual(W - st.r[i]! + 1e-6);
            expect(st.y[i]).toBeGreaterThanOrEqual(st.r[i]! - 1e-6);
            expect(st.y[i]).toBeLessThanOrEqual(H - st.r[i]! + 1e-6);
        }
    });

    it('keeps discs inside the board through a full chaotic run', () => {
        st.n = 0;
        for (let i = 0; i < 12; i++) place(i, 40 + (i % 4) * 90, 200 + Math.floor(i / 4) * 200);
        kickAll(st, 1600);

        for (let k = 0; k < 1200; k++) {
            stepWorld(st, 1 / 60);
            for (let i = 0; i < st.n; i++) {
                if (
                    st.x[i]! < st.r[i]! - 1e-6 || st.x[i]! > W - st.r[i]! + 1e-6
                    || st.y[i]! < st.r[i]! - 1e-6 || st.y[i]! > H - st.r[i]! + 1e-6
                ) {
                    throw new Error(
                        `disc ${i} escaped at frame ${k}: (${st.x[i]}, ${st.y[i]}) r=${st.r[i]}`,
                    );
                }
            }
        }
    });

    it('always reaches quiescence from a hard kick', () => {
        for (let i = 0; i < 12; i++) place(i, 40 + (i % 4) * 90, 200 + Math.floor(i / 4) * 200);
        kickAll(st, 1600);
        let settled = 0;
        for (let k = 0; k < 3000 && settled === 0; k++) settled = stepWorld(st, 1 / 60);
        expect(settled).toBe(1);
    });
});

describe('world', () => {
    it('gives slots only to live discs and reports the live count', () => {
        // packWorld layout: [id, owner, r, x, y, alive, embers]
        applyWorld(st, [
            7, 0, 22, 100, 900, 1, 3,
            8, 1, 14, 200, 100, 0, 0,
            9, 1, 14, 300, 120, 1, 2,
        ], W, H, 5, 0, 0.87 * H, H);

        expect(st.n).toBe(2);
        expect(st.id[0]).toBe(7);
        expect(st.id[1]).toBe(9);
        expect(st.seq).toBe(5);
    });

    it('hands over a board at rest, so the first tick does not report a settle', () => {
        applyWorld(st, [0, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        expect(st.phase).toBe(0);
        st.phase = SIM_RUNNING;
        // Awake is 0 already; one step must find it settled rather than
        // pretending the board is in motion.
        expect(stepWorld(st, 1 / 60)).toBe(1);
    });

    it('derives inverse mass so a big disc is exactly mass 1', () => {
        applyWorld(st, [0, 0, 22, 100, 900, 1, 3, 1, 0, 14, 200, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        expect(st.im[0]).toBeCloseTo(1, 6);
        expect(1 / st.im[1]!).toBeCloseTo((14 * 14) / (22 * 22), 6);
    });

    it('sizes the grid to the largest disc so the neighbour walk stays complete', () => {
        applyWorld(st, [0, 0, 22, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        expect(st.cell).toBe(44);
        expect(st.head.length).toBeGreaterThanOrEqual(st.cols * st.rows);
    });

    it('forces the first write past the dirty cull', () => {
        // Slot n may have held a different disc last turn, so its last-written
        // position is meaningless.
        applyWorld(st, [0, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        expect(st.lx[0]).toBeLessThan(-9999);
    });

    it('finds a disc by id, and reports -1 for one that is gone', () => {
        applyWorld(st, [7, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        expect(slotOf(st, 7)).toBe(0);
        expect(slotOf(st, 8)).toBe(-1);
    });

    it('launches by id and starts the simulation', () => {
        applyWorld(st, [7, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        launch(st, 7, 100, -400, 9);

        expect(st.phase).toBe(SIM_RUNNING);
        expect(st.vy[0]).toBe(-400);
        expect(st.seq).toBe(9);
        expect(st.sleep[0]).toBe(0);
    });

    it('caps launch speed so nothing tunnels', () => {
        applyWorld(st, [7, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        launch(st, 7, 0, -99999, 1);
        expect(speedOf(0)).toBeCloseTo(MAX_LAUNCH_SPEED, 6);
    });

    it('preserves launch direction while capping', () => {
        applyWorld(st, [7, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        launch(st, 7, 3000, -4000, 1);
        expect(st.vx[0]! / st.vy[0]!).toBeCloseTo(3000 / -4000, 6);
    });

    it('ignores a launch for an unknown disc', () => {
        applyWorld(st, [7, 0, 14, 100, 900, 1, 3], W, H, 1, 0, 0.87 * H, H);
        launch(st, 99, 0, -400, 1);
        expect(st.phase).toBe(0);
    });

    it('kicks every disc in a deterministic spray', () => {
        const spray = (): number[] => {
            const s = createSimState(8);
            s.w = W;
            s.h = H;
            st = s;
            applyWorld(s, [
                0, 0, 14, 100, 900, 1, 3,
                1, 0, 14, 200, 900, 1, 3,
                2, 0, 14, 300, 900, 1, 3,
            ], W, H, 1, 0, 0.87 * H, H);
            kickAll(s, 800);
            return [s.vx[0]!, s.vy[0]!, s.vx[1]!, s.vy[1]!, s.vx[2]!, s.vy[2]!];
        };
        // Deterministic, or two measurements aren't comparable.
        expect(spray()).toEqual(spray());
        // And every disc actually moves, in its own direction.
        const v = spray();
        expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(800, 6);
        expect(v[0]).not.toBeCloseTo(v[2]!, 3);
    });
});

describe('restitution', () => {
    it('keeps most of the closing speed, as a puck on a slick surface does', () => {
        place(0, 200, 480, 0, 400);
        place(1, 200, 480 + 26, 0, 0);
        emitPairs(st);
        resolvePairs(st);
        const separation = st.vy[1]! - st.vy[0]!;
        expect(separation).toBeCloseTo(400 * RESTITUTION, 4);
    });
});
