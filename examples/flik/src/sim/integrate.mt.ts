/**
 * Integration phase: friction, position update, wall reflection, sleep.
 *
 * A `'main thread'` worklet. Two consequences shape the code:
 *
 *  - **No free identifiers.** SWC captures them into `_c` and JSON-serializes
 *    that, so an imported constant or helper arrives as `undefined` on the
 *    main thread. Every tuning value is written as a literal here; `tuning.ts`
 *    documents them and a test asserts the two agree.
 *  - **Locals, not property loads.** `st.x[i]` inside the inner loop is two
 *    lookups on an interpreted VM. Hoisting each array into a local before the
 *    loop is worth real time at 400 discs.
 *
 * It is also just a function in node — `'main thread'` is a string expression
 * statement — which is what lets the tests exercise the real physics rather
 * than a copy of it.
 */

import type { SimState } from './state.js';

export function integrateStep(st: SimState, h: number): void {
    'main thread';
    const x = st.x;
    const y = st.y;
    const vx = st.vx;
    const vy = st.vy;
    const r = st.r;
    const alive = st.alive;
    const sleep = st.sleep;
    const n = st.n;
    const W = st.w;
    const H = st.h;

    // FRICTION = 900, DRAG = 0.6, WALL_BOUNCE = 0.72,
    // SLEEP_SPEED = 6, SLEEP_FRAMES = 6 — see tuning.ts.
    const decel = 900 * h;
    const visc = 1 - 0.6 * h;
    const bounce = 0.72;
    const sleepSpeedSq = 6 * 6;
    let awake = 0;

    for (let i = 0; i < n; i++) {
        if (alive[i] === 0) continue;

        let ux = vx[i]!;
        let uy = vy[i]!;

        if (ux !== 0 || uy !== 0) {
            const speed = Math.sqrt(ux * ux + uy * uy);
            if (speed <= decel) {
                // Coulomb friction removes a fixed amount of speed per unit
                // time, so below that amount the disc stops dead this step
                // rather than reversing.
                ux = 0;
                uy = 0;
            } else {
                const k = (1 - decel / speed) * visc;
                ux *= k;
                uy *= k;
            }
        }

        if (ux * ux + uy * uy < sleepSpeedSq) {
            if (sleep[i]! < 6) sleep[i] = sleep[i]! + 1;
        } else {
            sleep[i] = 0;
        }
        if (sleep[i]! < 6) awake++;

        let px = x[i]! + ux * h;
        let py = y[i]! + uy * h;
        const rad = r[i]!;

        // Reflect about the wall rather than clamping to it: clamping parks a
        // fast disc exactly on the boundary and drops the overshoot, which
        // reads as the puck sticking.
        if (px < rad) {
            px = rad + (rad - px);
            ux = -ux * bounce;
            sleep[i] = 0;
        } else if (px > W - rad) {
            px = (W - rad) - (px - (W - rad));
            ux = -ux * bounce;
            sleep[i] = 0;
        }
        if (py < rad) {
            py = rad + (rad - py);
            uy = -uy * bounce;
            sleep[i] = 0;
        } else if (py > H - rad) {
            py = (H - rad) - (py - (H - rad));
            uy = -uy * bounce;
            sleep[i] = 0;
        }

        // A reflection from a disc already outside the wall (possible after a
        // positional correction shoved it there) can land outside again.
        // Clamp as the backstop so nothing escapes the board.
        if (px < rad) px = rad;
        else if (px > W - rad) px = W - rad;
        if (py < rad) py = rad;
        else if (py > H - rad) py = H - rad;

        x[i] = px;
        y[i] = py;
        vx[i] = ux;
        vy[i] = uy;
    }

    st.awake = awake;
}
