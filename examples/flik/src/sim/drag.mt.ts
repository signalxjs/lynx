/**
 * Grab, reposition, flick — the whole input model, on the main thread.
 *
 * You put a finger on one of your discs and it follows you, but only inside
 * your own end of the board. Let go slowly and it just stays where you left
 * it; let go while moving and it launches at the speed your finger was
 * travelling. The shot is your hand, not a charge meter — so there is nothing
 * to draw and nothing to aim, and the only thing that decides the outcome is
 * how hard you flicked.
 *
 * It all lives here so the release velocity never leaves the main thread:
 * `onEnd` has it in hand and starts the simulation in the same frame, rather
 * than posting it to the background thread and waiting to be told to start.
 */

import type { SimState } from './state.js';

/** Extra touch radius, so a small disc is not a precision test. */
const TOUCH_SLOP = 14;
/**
 * Below this release speed (board px/s) the disc was placed, not thrown.
 * Repositioning must not cost a turn, or the "move it freely" half of the
 * gesture would be a trap.
 */
const MIN_FLICK_SPEED = 140;

/**
 * The loadable disc nearest `(px, py)`, or -1.
 *
 * Nearest rather than first-hit: overlapping discs in a crowded home zone
 * would otherwise be picked by array order, which is invisible to the player.
 * Only the current player's discs inside their own home band are eligible —
 * the same condition `loadableDiscs` applies on the background thread.
 */
export function pickDisc(st: SimState, px: number, py: number): number {
    'main thread';
    let best = -1;
    let bestDistSq = 0;
    for (let i = 0; i < st.n; i++) {
        if (st.alive[i] === 0) continue;
        if (st.owner[i] !== st.turn) continue;
        const cy = st.y[i]!;
        if (cy < st.homeY0 || cy >= st.homeY1) continue;
        const dx = px - st.x[i]!;
        const dy = py - cy;
        const distSq = dx * dx + dy * dy;
        const reach = st.r[i]! + 14; // TOUCH_SLOP
        if (distSq > reach * reach) continue;
        if (best === -1 || distSq < bestDistSq) {
            best = i;
            bestDistSq = distSq;
        }
    }
    return best;
}

/**
 * Grab whatever is under the finger. Returns 1 if a disc was caught.
 *
 * The finger-to-centre offset is kept so the disc doesn't snap its centre to
 * the touch point — you grab it where you touched it.
 */
export function dragBegin(st: SimState, pageX: number, pageY: number, now: number): number {
    'main thread';
    if (st.phase !== 0) return 0; // only between shots
    const px = pageX - st.originX;
    const py = pageY - st.originY;
    const slot = pickDisc(st, px, py);
    if (slot < 0) {
        st.dragActive = 0;
        st.dragSlot = -1;
        return 0;
    }
    st.dragActive = 1;
    st.dragSlot = slot;
    st.dragOffX = st.x[slot]! - px;
    st.dragOffY = st.y[slot]! - py;
    st.dragPrevX = px;
    st.dragPrevY = py;
    st.dragPrevT = now;
    st.dragVX = 0;
    st.dragVY = 0;
    return 1;
}

/**
 * Move the held disc, clamped to the player's own end, and track how fast the
 * finger is going.
 *
 * The clamp is the rule "you can only move it freely inside your area", and it
 * is applied to the DISC rather than the finger: your finger can wander past
 * the band while the disc stops at the line, which is far less frustrating
 * than having the disc stop following you.
 */
export function dragMove(st: SimState, pageX: number, pageY: number, now: number): void {
    'main thread';
    if (st.dragActive === 0) return;
    const slot = st.dragSlot;
    if (slot < 0) return;

    const px = pageX - st.originX;
    const py = pageY - st.originY;

    // Velocity in board px/s, lightly smoothed. A single raw sample is noisy
    // enough that two identical-feeling flicks can differ by a lot, and the
    // last sample before release is the noisiest of all.
    const dt = now - st.dragPrevT;
    if (dt > 0) {
        const vx = ((px - st.dragPrevX) / dt) * 1000;
        const vy = ((py - st.dragPrevY) / dt) * 1000;
        st.dragVX = st.dragVX * 0.4 + vx * 0.6;
        st.dragVY = st.dragVY * 0.4 + vy * 0.6;
        st.dragPrevX = px;
        st.dragPrevY = py;
        st.dragPrevT = now;
    }

    const r = st.r[slot]!;
    let nx = px + st.dragOffX;
    let ny = py + st.dragOffY;
    if (nx < r) nx = r;
    else if (nx > st.w - r) nx = st.w - r;
    // Your own band, not the whole board.
    let lo = st.homeY0 + r;
    let hi = st.homeY1 - r;
    if (hi < lo) { lo = (st.homeY0 + st.homeY1) / 2; hi = lo; }
    if (ny < lo) ny = lo;
    else if (ny > hi) ny = hi;

    st.x[slot] = nx;
    st.y[slot] = ny;
    st.vx[slot] = 0;
    st.vy[slot] = 0;
    st.sleep[slot] = 6;
}

/**
 * Let go. Returns the shot as `[discId, vx, vy]`, or `null` when the disc was
 * placed rather than thrown.
 *
 * ### Size is felt twice
 *
 * A big disc is heavier, and that shows up at both ends of the shot. It leaves
 * your finger SLOWER for the same flick — the same effort against more mass —
 * and it hits harder when it arrives, because the collision impulses are
 * mass-weighted. Net momentum still favours the big disc by about half again,
 * so the trade is real rather than a wash: the big ones are the wrecking
 * balls, the small ones are the ones you can actually place.
 *
 * The scaling is `sqrt` rather than linear mass, which would make a small disc
 * two and a half times faster than a big one and turn the big discs into dead
 * weight. Normalised so a SMALL disc launches at exactly finger speed.
 *
 * Speed is capped here rather than only in `launch`, so the caller sees the
 * real shot it is about to fire; `launch` caps again as a backstop.
 */
export function dragRelease(st: SimState): number[] | null {
    'main thread';
    if (st.dragActive === 0 || st.dragSlot < 0) return null;
    const slot = st.dragSlot;
    st.dragActive = 0;
    st.dragSlot = -1;

    let vx = st.dragVX;
    let vy = st.dragVY;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 140) return null; // MIN_FLICK_SPEED — placed, not thrown

    // 0.40495867 = (14/22)^2, the small disc's mass on the scale where the big
    // one is 1. `im` is inverse mass, so this is sqrt(mSmall / mass).
    const heft = Math.sqrt(0.40495867768595 * st.im[slot]!);
    vx *= heft;
    vy *= heft;

    const launched = Math.sqrt(vx * vx + vy * vy);
    if (launched > 1800) {
        const k = 1800 / launched;
        vx *= k;
        vy *= k;
    }
    return [st.id[slot]!, vx, vy];
}

/** Abandon a drag without firing (gesture cancelled). */
export function dragCancel(st: SimState): void {
    'main thread';
    st.dragActive = 0;
    st.dragSlot = -1;
    st.dragVX = 0;
    st.dragVY = 0;
}

/** Documented tuning, mirrored as literals inside the worklets above. */
export const DRAG_TUNING = { slop: TOUCH_SLOP, minFlick: MIN_FLICK_SPEED };
