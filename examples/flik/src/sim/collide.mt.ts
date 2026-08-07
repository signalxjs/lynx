/**
 * Collision resolution: one hot loop over the candidate pairs.
 *
 * The pair math is INLINE here and nowhere else. A worklet per pair would be
 * correct and unusably slow — at 200 discs the grid emits ~800 candidates a
 * substep, four substeps a frame, so a per-pair call is 192,000 bound
 * invocations a second. One worklet per phase, iterating internally, is the
 * rule the whole `sim/` directory follows.
 *
 * Impulses use inverse mass, so a big disc (mass 1.0) shoves a small one
 * (~0.405) roughly two and a half times as far as it recoils — which is the
 * entire reason FLIK has two disc sizes.
 */

import type { SimState } from './state.js';

export function resolvePairs(st: SimState): void {
    'main thread';
    const x = st.x;
    const y = st.y;
    const vx = st.vx;
    const vy = st.vy;
    const r = st.r;
    const im = st.im;
    const sleep = st.sleep;
    const pi = st.pi;
    const pj = st.pj;
    const np = st.np;
    const W = st.w;
    const H = st.h;

    // RESTITUTION = 0.94, CORRECTION = 0.8 — see tuning.ts.
    const e = 0.94;
    const correction = 0.8;
    let contacts = 0;
    let big = st.bigHit;

    for (let p = 0; p < np; p++) {
        const i = pi[p]!;
        const j = pj[p]!;

        const dx = x[j]! - x[i]!;
        const dy = y[j]! - y[i]!;
        const sumR = r[i]! + r[j]!;
        const distSq = dx * dx + dy * dy;
        if (distSq >= sumR * sumR) continue;

        let dist = Math.sqrt(distSq);
        let nx: number;
        let ny: number;
        if (dist > 1e-6) {
            nx = dx / dist;
            ny = dy / dist;
        } else {
            // Exactly concentric: any axis will do, and picking one beats
            // dividing by zero. Rare, but two discs spawned on top of each
            // other in stress mode hit it.
            nx = 1;
            ny = 0;
            dist = 0;
        }

        const imi = im[i]!;
        const imj = im[j]!;
        const imSum = imi + imj;
        if (imSum <= 0) continue;

        // Push apart along the normal, split by inverse mass — the lighter
        // disc moves further. Only a fraction per substep, or a crowded
        // cluster jitters.
        const corr = ((sumR - dist) * correction) / imSum;
        let xi = x[i]! - nx * corr * imi;
        let yi = y[i]! - ny * corr * imi;
        let xj = x[j]! + nx * corr * imj;
        let yj = y[j]! + ny * corr * imj;

        // Keep the correction inside the board. This clamp is NOT redundant
        // with the one in `integrateStep`: resolution runs after it in each
        // substep, so a pair separating against a wall can be shoved outside —
        // and on the substep that reaches quiescence there is no next
        // integration to pull it back, so the disc settles half off the board
        // and stays there. (Caught on device: two discs stacked at the right
        // cushion, clipped by the board's overflow.)
        const ri = r[i]!;
        const rj = r[j]!;
        if (xi < ri) xi = ri;
        else if (xi > W - ri) xi = W - ri;
        if (yi < ri) yi = ri;
        else if (yi > H - ri) yi = H - ri;
        if (xj < rj) xj = rj;
        else if (xj > W - rj) xj = W - rj;
        if (yj < rj) yj = rj;
        else if (yj > H - rj) yj = H - rj;

        x[i] = xi;
        y[i] = yi;
        x[j] = xj;
        y[j] = yj;

        // Normal impulse. Skip if they are already separating: overlapping
        // discs are resolved over several substeps, and re-impulsing on each
        // one would pump energy in.
        const rvn = (vx[j]! - vx[i]!) * nx + (vy[j]! - vy[i]!) * ny;
        if (rvn >= 0) continue;

        const jn = (-(1 + e) * rvn) / imSum;
        vx[i] = vx[i]! - jn * nx * imi;
        vy[i] = vy[i]! - jn * ny * imi;
        vx[j] = vx[j]! + jn * nx * imj;
        vy[j] = vy[j]! + jn * ny * imj;

        sleep[i] = 0;
        sleep[j] = 0;
        contacts++;
        if (jn > big) big = jn;
    }

    st.contacts = contacts;
    st.bigHit = big;
}
