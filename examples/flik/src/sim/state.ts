/**
 * The simulation's world, as one plain object living in a `MainThreadRef`.
 *
 * Shape constraints, both load-bearing:
 *
 *  - **Structure-of-arrays, preallocated to `maxN` and never resized.** The
 *    integrator touches every field of every disc each substep, and growing an
 *    array mid-frame is the one allocation a 60 Hz loop cannot afford. Index
 *    `i` is the same disc in every array.
 *  - **JSON-serializable, no class instances and no functions.** It crosses to
 *    the main thread once as an `INIT_MT_REF` init value, and anything that
 *    doesn't survive `JSON.stringify` arrives as `undefined` there.
 *
 * Everything else about the design follows from who owns the board when: the
 * background thread owns it between shots, the main thread owns it during one,
 * and neither reads the other's copy while it isn't theirs. There is no
 * merging step because there is never anything to merge.
 */

/** Phase the SIMULATION is in — distinct from the game's own `Phase`. */
export const SIM_IDLE = 0;
export const SIM_RUNNING = 1;
/** Settled, waiting for the background thread to pick the result up. */
export const SIM_SETTLED = 2;

/** Render paths, compared in a later PR. `write.mt.ts` dispatches on this. */
export const RENDER_SHARED_VALUE = 0;
export const RENDER_RAW = 1;
export const RENDER_UNBRIDGED = 2;

export interface SimState {
    // ---- board geometry (authored by BG, read by the integrator) ----
    w: number;
    h: number;
    /**
     * The board's top-left in PAGE coordinates. Gesture events report page
     * coords and the simulation works in board coords, so this is the only
     * thing that reconciles them.
     */
    originX: number;
    originY: number;

    // ---- whose turn, and what they may launch ----
    turn: number;
    /**
     * The current player's home band in board px. Sent from the background
     * thread rather than recomputed here: the band table in `game/board.ts` is
     * the single source of truth for the rules, and a second copy of those
     * fractions inside a worklet is exactly how the two drift apart.
     */
    homeY0: number;
    homeY1: number;

    // ---- dragging a disc before the flick, all main-thread ----
    dragActive: number;
    /** Simulation slot under the finger, or -1. */
    dragSlot: number;
    /** Offset from the finger to the disc centre, so it doesn't jump on grab. */
    dragOffX: number;
    dragOffY: number;
    /** Previous finger sample, for the release velocity. */
    dragPrevX: number;
    dragPrevY: number;
    dragPrevT: number;
    /** Latest finger velocity in board px/s — this IS the shot. */
    dragVX: number;
    dragVY: number;

    // ---- discs, structure-of-arrays ----
    n: number;
    maxN: number;
    /**
     * The game's disc id for slot `i`. Not the same as `i`: the simulation
     * packs live discs contiguously, so a burnt-out disc leaves the slots
     * behind it renumbered while its id stays what the ruleset knows it by.
     */
    id: number[];
    x: number[];
    y: number[];
    vx: number[];
    vy: number[];
    r: number[];
    /** Inverse mass. Zero would mean immovable; no disc uses that yet. */
    im: number[];
    owner: number[];
    alive: number[];
    /**
     * Consecutive substeps spent below the sleep threshold. A counter rather
     * than a flag so a disc creeping to a halt doesn't flicker awake.
     */
    sleep: number[];
    /** Last position actually written to an element — the dirty-write cull. */
    lx: number[];
    ly: number[];

    // ---- broadphase scratch, preallocated ----
    /** Head index per grid cell, or -1. */
    head: number[];
    /** Next disc index in the same cell, or -1. */
    next: number[];
    /** Candidate pair buffers. `np` is how many of them are live. */
    pi: number[];
    pj: number[];
    np: number;
    cell: number;
    cols: number;
    rows: number;

    // ---- control ----
    phase: number;
    /** Echoed in the settle payload so BG can drop a superseded shot. */
    seq: number;
    /** Discs not yet asleep. Zero means the board has settled. */
    awake: number;
    /** Fixed-timestep accumulator, seconds. */
    acc: number;
    fixedDt: number;
    maxSub: number;
    /** `Date.now()` of the previous tick, for the frame delta. */
    lastT: number;

    // ---- knobs the stress panel flips live ----
    renderMode: number;
    /** 0 = all-pairs, 1 = uniform grid. */
    broadphase: number;
    /** 1 = write every disc every frame, defeating the dirty-write cull. */
    writeAll: number;
    /** 1 = keep sub-pixel precision in the transform string. */
    subpixel: number;
    /** 1 = re-kick at quiescence instead of settling — a sustained worst case. */
    stressLoop: number;

    // ---- counters, drained by the perf HUD ----
    /** Largest normal impulse this shot, so BG can pick a haptic strength. */
    bigHit: number;
    /** Candidate pairs and actual contacts in the last substep. */
    tests: number;
    contacts: number;
    /** Element writes in the last frame. */
    writes: number;

    // ---- render bindings, injected after mount ----
    /** Element refs, index-aligned with the disc arrays. */
    els: unknown[] | null;
    /** Value envelopes for the SharedValue-based render paths. */
    svs: unknown[] | null;

    /** Preallocated settle buffer, so quiescence doesn't allocate. */
    packed: number[];
}

function zeros(n: number): number[] {
    return new Array<number>(n).fill(0);
}

/**
 * Allocate a world sized for at most `maxN` discs. Called once on the
 * background thread; the arrays cross to the main thread with the ref and are
 * mutated in place from then on.
 *
 * `pairCap` bounds the candidate buffer. All-pairs at `maxN` would be
 * `maxN²/2`, which at 400 discs is 80,000 entries — so the buffer is capped
 * and `emitPairs` stops filling it when full. Dropping a candidate can only
 * miss a collision for one substep, whereas allocating per frame would cost
 * every frame.
 */
export function createSimState(maxN: number, pairCap = maxN * 24): SimState {
    return {
        w: 0,
        h: 0,
        originX: 0,
        originY: 0,

        turn: 0,
        homeY0: 0,
        homeY1: 0,

        dragActive: 0,
        dragSlot: -1,
        dragOffX: 0,
        dragOffY: 0,
        dragPrevX: 0,
        dragPrevY: 0,
        dragPrevT: 0,
        dragVX: 0,
        dragVY: 0,

        n: 0,
        maxN,
        id: zeros(maxN),
        x: zeros(maxN),
        y: zeros(maxN),
        vx: zeros(maxN),
        vy: zeros(maxN),
        r: zeros(maxN),
        im: zeros(maxN),
        owner: zeros(maxN),
        alive: zeros(maxN),
        sleep: zeros(maxN),
        lx: zeros(maxN),
        ly: zeros(maxN),

        head: zeros(1),
        next: zeros(maxN),
        pi: zeros(pairCap),
        pj: zeros(pairCap),
        np: 0,
        cell: 1,
        cols: 1,
        rows: 1,

        phase: SIM_IDLE,
        seq: 0,
        awake: 0,
        acc: 0,
        fixedDt: 1 / 120,
        maxSub: 4,
        lastT: 0,

        renderMode: RENDER_RAW,
        broadphase: 1,
        writeAll: 0,
        subpixel: 1,
        stressLoop: 0,

        bigHit: 0,
        tests: 0,
        contacts: 0,
        writes: 0,

        els: null,
        svs: null,

        // Three numbers per disc (id, x, y), sized for the worst case. The
        // settle happens INSIDE the frame, so it must not grow an array
        // element by element the way an empty one would. `stepWorld` then
        // truncates to the live count — a shrink, and only on the first
        // settle, since the length is stable while the disc count is (the
        // truncation is worth it: the buffer crosses the bridge as JSON, and
        // shipping 1200 numbers to describe 12 discs is not).
        packed: zeros(maxN * 3),
    };
}
