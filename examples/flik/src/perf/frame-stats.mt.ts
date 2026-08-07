/**
 * Frame instrumentation, on the main thread.
 *
 * Two numbers matter and they are not the same number:
 *
 *  - **frame interval** — wall time between one tick and the next. What the
 *    player feels.
 *  - **tick cost** — how long our own worklet body took. What we spend.
 *
 * Their divergence is the whole diagnosis. Cost 4ms against an interval of
 * 33ms means the time is going somewhere we don't control (native layout, the
 * flush, another thread); cost 28ms against 33ms means it is our JavaScript.
 * Reporting only "fps" would collapse the two and answer neither question.
 *
 * ### On timer honesty
 *
 * There is no `performance.now()` on the main thread — `lynx.performance` is
 * the profiling surface, not a clock — so everything here is `Date.now()`,
 * which is 1ms granular. That is roughly ±6% on a 16.7ms frame. So this
 * records a bucketed DISTRIBUTION and never pretends to a precise percentile:
 * a three-decimal p95 off a 1ms clock would be fiction. For a real verdict,
 * bracket the tick with `lynx.performance.profileStart/End` and read a
 * Perfetto or Instruments trace.
 *
 * The accumulation is deliberately ~5 arithmetic operations per frame. An
 * instrument that costs a measurable share of the thing it measures is worse
 * than no instrument, because it looks like data.
 */

import type { SimState } from '../sim/state.js';

/** Upper edges of the frame-interval buckets, in ms. */
export const BUCKET_EDGES = [8, 12, 17, 21, 25, 34, 50] as const;
/** How many numbers `drainStats` returns. */
export const STATS_LEN = 8 + 8;
/** Publish cadence, ms. */
export const PUBLISH_MS = 500;

/**
 * Record one frame. `t0`/`t1` bracket the tick body, so `t1 - t0` is our cost
 * and `t0 - prevT0` is the interval the player experienced.
 */
export function recordFrame(st: SimState, t0: number, t1: number): void {
    'main thread';
    const prev = st.statPrevT0;
    st.statPrevT0 = t0;
    const cost = t1 - t0;
    st.statCostSum += cost;
    if (cost > st.statCostMax) st.statCostMax = cost;

    if (prev === 0) return; // first frame of a run has no interval
    const dt = t0 - prev;
    // A resumed app or a paused debugger produces a gap that is not a frame.
    if (dt <= 0 || dt >= 1000) return;

    // Peaks over the window, not a sample of whichever frame happened to be
    // last: the drain lands at an arbitrary moment, and reading the instant
    // value there reported "0 writes" while a disc was visibly moving.
    if (st.writes > st.statWritesMax) st.statWritesMax = st.writes;
    if (st.contacts > st.statContactsMax) st.statContactsMax = st.contacts;

    st.statFrames++;
    st.statSum += dt;
    if (dt > st.statMax) st.statMax = dt;
    // Anything past ~20ms missed a 60Hz vsync.
    if (dt > 20) st.statDropped++;

    const b = dt <= 8 ? 0
        : dt <= 12 ? 1
            : dt <= 17 ? 2
                : dt <= 21 ? 3
                    : dt <= 25 ? 4
                        : dt <= 34 ? 5
                            : dt <= 50 ? 6
                                : 7;
    st.statBuckets[b] = st.statBuckets[b]! + 1;
}

/**
 * 1 when it is time to publish to the background thread.
 *
 * The cadence is written as a literal rather than referencing `PUBLISH_MS`,
 * even though that constant lives in this very file. A worklet body cannot
 * reach a module-scope binding at runtime: SWC captures free identifiers into
 * `_c` and JSON-serializes it, so the constant would arrive as `undefined` and
 * the comparison would be against NaN. Same constraint that keeps the physics
 * tuning inlined; `PUBLISH_MS` exists to document the value and is asserted
 * against this literal by the tests.
 */
export function shouldPublish(st: SimState, now: number): number {
    'main thread';
    if (now - st.statPubT < 500) return 0; // PUBLISH_MS
    st.statPubT = now;
    return 1;
}

/**
 * Snapshot the counters into the preallocated buffer and reset them.
 *
 * Layout: `[frames, sumMs, maxMs, dropped, costSumMs, costMaxMs, peakWrites,
 * peakContacts, ...8 buckets]`. Flat numbers, and a buffer that already exists,
 * because this runs inside the frame.
 */
export function drainStats(st: SimState): number[] {
    'main thread';
    const out = st.statOut;
    out[0] = st.statFrames;
    out[1] = st.statSum;
    out[2] = st.statMax;
    out[3] = st.statDropped;
    out[4] = st.statCostSum;
    out[5] = st.statCostMax;
    out[6] = st.statWritesMax;
    out[7] = st.statContactsMax;
    for (let i = 0; i < 8; i++) {
        out[8 + i] = st.statBuckets[i]!;
        st.statBuckets[i] = 0;
    }
    st.statFrames = 0;
    st.statSum = 0;
    st.statMax = 0;
    st.statDropped = 0;
    st.statCostSum = 0;
    st.statCostMax = 0;
    st.statWritesMax = 0;
    st.statContactsMax = 0;
    return out;
}

/**
 * Draw the frame-interval sparkline by writing ONE bar per frame.
 *
 * Exactly one `setStyleProperty` per frame, and only `height`. An earlier
 * version also wrote `opacity` to flag a dropped frame, which quietly doubled
 * the cost of the one thing in the app that must not perturb what it measures.
 * The height already says it: a 50ms frame draws six times the bar of an 8ms
 * one, which is not subtle.
 *
 * This is the readout to trust while measuring: its cost is constant in the
 * number of discs and it never touches the background thread. The numeric
 * panel goes the other way — richer, but over the bridge at 2Hz.
 */
export function drawSpark(st: SimState, dt: number): void {
    'main thread';
    const bars = st.sparkEls as Array<{ current?: {
        setStyleProperty?: (k: string, v: string) => void;
    } | null }> | null;
    if (!bars) return;
    const n = bars.length;
    if (n === 0) return;

    const slot = st.statFrames % n;
    const holder = bars[slot];
    const el = holder && holder.current;
    if (!el || !el.setStyleProperty) return;

    // 16.7ms maps to about a third of the track, so a good frame sits low and
    // a bad one is unmistakable rather than a subtle difference in height.
    let h = dt;
    if (h > 50) h = 50;
    if (h < 1) h = 1;
    el.setStyleProperty('height', (h * 0.7).toFixed(1) + 'px');
}
