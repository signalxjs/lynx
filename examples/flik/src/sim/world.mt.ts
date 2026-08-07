/**
 * World mutation — everything that changes the board other than stepping it.
 *
 * All `'main thread'` worklets, so both the background thread (via
 * `runOnMainThread`) and other worklets (a gesture's `onEnd`) can call them.
 */

import type { SimState } from './state.js';

/**
 * Adopt a board packed by `packWorld`: `[id, owner, r, x, y, alive, embers]`
 * per disc. This is the once-per-turn background-to-main handoff.
 *
 * Only live discs get slots, so `n` is the live count and the arrays stay
 * contiguous for the integrator. Embers aren't copied — the simulation has no
 * use for them, and the ruleset is the only thing that should be counting.
 */
export function applyWorld(
    st: SimState,
    packed: number[],
    width: number,
    height: number,
    seq: number,
    turn: number,
    homeY0: number,
    homeY1: number,
): void {
    'main thread';
    st.w = width;
    st.h = height;
    st.seq = seq;
    // Turn and the current player's home band come from the background
    // thread rather than being recomputed here: the band table in
    // `game/board.ts` is the rules' single source of truth, and a second copy
    // of those fractions inside a worklet is how the two drift apart.
    st.turn = turn;
    st.homeY0 = homeY0;
    st.homeY1 = homeY1;
    st.dragActive = 0;
    st.dragSlot = -1;

    let n = 0;
    let maxR = 1;
    for (let p = 0; p + 7 <= packed.length; p += 7) {
        if (packed[p + 5] === 0) continue; // burnt out — no slot
        if (n >= st.maxN) break;
        const r = packed[p + 2]!;
        st.id[n] = packed[p]!;
        st.owner[n] = packed[p + 1]!;
        st.r[n] = r;
        // Inverse mass from area, normalised so r=22 is mass 1 — matches
        // `massOf` in game/setup.ts.
        st.im[n] = (22 * 22) / (r * r);
        st.x[n] = packed[p + 3]!;
        st.y[n] = packed[p + 4]!;
        st.vx[n] = 0;
        st.vy[n] = 0;
        st.alive[n] = 1;
        // Asleep on arrival: a board handed over between shots is at rest, and
        // marking it awake would make the first tick report a settle.
        st.sleep[n] = 6;
        // Force the first write through the dirty cull, whatever was here
        // before — the previous turn's slot `n` may have been another disc.
        st.lx[n] = -99999;
        st.ly[n] = -99999;
        if (r > maxR) maxR = r;
        n++;
    }
    st.n = n;

    // Grid sized to the largest disc: with cells 2·maxR across, two discs can
    // only touch if they are in the same cell or adjacent ones, which is what
    // makes the four-forward-neighbour walk complete.
    const cell = maxR * 2;
    st.cell = cell;
    st.cols = Math.max(1, Math.ceil(width / cell));
    st.rows = Math.max(1, Math.ceil(height / cell));
    const cells = st.cols * st.rows;
    if (st.head.length < cells) st.head.length = cells;

    st.phase = 0; // SIM_IDLE
    st.acc = 0;
    st.awake = 0;
    st.bigHit = 0;
}

/** Slot holding disc `id`, or -1. Linear — `n` is at most a few hundred. */
export function slotOf(st: SimState, id: number): number {
    'main thread';
    for (let i = 0; i < st.n; i++) {
        if (st.id[i] === id && st.alive[i] === 1) return i;
    }
    return -1;
}

/**
 * Launch disc `id` and start the simulation. Speed is capped so nothing
 * tunnels; see `MAX_LAUNCH_SPEED` in tuning.ts.
 */
export function launch(st: SimState, id: number, vx: number, vy: number, seq: number): void {
    'main thread';
    let i = -1;
    for (let k = 0; k < st.n; k++) {
        if (st.id[k] === id && st.alive[k] === 1) {
            i = k;
            break;
        }
    }
    if (i < 0) return;

    let sx = vx;
    let sy = vy;
    const speed = Math.sqrt(sx * sx + sy * sy);
    if (speed > 1800) {
        const k = 1800 / speed;
        sx *= k;
        sy *= k;
    }

    st.vx[i] = sx;
    st.vy[i] = sy;
    st.sleep[i] = 0;
    st.seq = seq;
    st.acc = 0;
    st.bigHit = 0;
    st.awake = 1;
    st.phase = 1; // SIM_RUNNING
}

/**
 * Fling every disc in a deterministic spray. The stress harness's agitator,
 * and the "does anything move at all" button while the aim gesture doesn't
 * exist yet.
 *
 * Deterministic because `Math.random()` would make two measurements
 * incomparable, and the whole point of the harness is comparing numbers.
 */
export function kickAll(st: SimState, speed: number): void {
    'main thread';
    for (let i = 0; i < st.n; i++) {
        if (st.alive[i] === 0) continue;
        // Cheap integer hash spread over the circle — no shared RNG state, and
        // slot `i` always gets the same direction.
        const h = (i * 2654435761) % 6553;
        const angle = (h / 6553) * Math.PI * 2;
        st.vx[i] = Math.cos(angle) * speed;
        st.vy[i] = Math.sin(angle) * speed;
        st.sleep[i] = 0;
    }
    st.acc = 0;
    st.bigHit = 0;
    st.awake = st.n;
    st.phase = 1; // SIM_RUNNING
}
