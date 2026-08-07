/**
 * One frame of simulation: fixed-timestep substeps, then a quiescence check.
 *
 * Deliberately PURE — it returns a status code and never touches the bridge.
 * The single `runOnBackground` for a settled board lives in `useSimLoop`, so
 * this stays a plain function the tests can drive with a scripted sequence of
 * frame deltas.
 *
 * Fixed timestep rather than variable, for three reasons in this order:
 * collision resolution with unequal masses is only stable at a bounded step;
 * a scripted dt sequence then makes the whole simulation a deterministic
 * regression test; and it decouples how often we simulate from how often we
 * render, which is the point of a stress harness.
 *
 * The imported phase functions are themselves `'main thread'` worklets, which
 * DO survive capture — SWC leaves a `{_wkltId}` placeholder and upstream's
 * walker resolves it to a real callable. (A plain imported function would
 * not; that is why the tuning constants are inlined instead.)
 */

import { integrateStep } from './integrate.mt.js';
import { emitPairs } from './broadphase.mt.js';
import { resolvePairs } from './collide.mt.js';
import type { SimState } from './state.js';

/** Board settled this frame — the caller should report it. */
export const TICK_SETTLED = 1;
/** Nothing to report. */
export const TICK_RUNNING = 0;

export function stepWorld(st: SimState, dtSec: number): number {
    'main thread';
    if (st.phase !== 1) return 0; // SIM_RUNNING

    st.acc += dtSec;
    const h = st.fixedDt;

    // Substep budget scales with the fastest disc: a puck at the launch cap
    // covers 15px in a 1/120s step against a 28px small-disc diameter, but a
    // head-on pair closes at twice that. More substeps while the board is
    // fast, fewer once it calms down.
    let maxSpeedSq = 0;
    for (let i = 0; i < st.n; i++) {
        if (st.alive[i] === 0) continue;
        const s = st.vx[i]! * st.vx[i]! + st.vy[i]! * st.vy[i]!;
        if (s > maxSpeedSq) maxSpeedSq = s;
    }
    let budget = st.maxSub;
    if (maxSpeedSq > 900 * 900) budget = st.maxSub * 2;

    let steps = 0;
    while (st.acc >= h && steps < budget) {
        integrateStep(st, h);
        emitPairs(st);
        resolvePairs(st);
        st.acc -= h;
        steps++;
    }
    // Ran out of budget: drop the backlog rather than carry it. Carrying it
    // means the next frame is even further behind, which is how a hitch turns
    // into a spiral the app never climbs out of.
    if (steps >= budget) st.acc = 0;

    if (st.awake !== 0) return 0;

    // Quiescence. Pack into the PREALLOCATED buffer — this runs inside the
    // frame, so it must not allocate.
    st.phase = 2; // SIM_SETTLED
    const packed = st.packed;
    let k = 0;
    for (let i = 0; i < st.n; i++) {
        if (st.alive[i] === 0) continue;
        packed[k++] = st.id[i]!;
        packed[k++] = Math.round(st.x[i]! * 100) / 100;
        packed[k++] = Math.round(st.y[i]! * 100) / 100;
    }
    packed.length = k;
    return 1;
}
