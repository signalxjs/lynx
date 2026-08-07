/**
 * Background-thread side of the frame instrumentation: turn the counters the
 * main thread drains into numbers a human reads.
 *
 * Pure — no `@sigx` imports — so the percentile maths is unit-tested rather
 * than eyeballed on a device.
 */

/** Upper edges of the frame-interval buckets, in ms. Mirrors `frame-stats.mt.ts`. */
export const BUCKET_EDGES = [8, 12, 17, 21, 25, 34, 50] as const;
/** Nominal upper bound for the overflow bucket, for interpolation only. */
const OVERFLOW_EDGE = 80;

export interface FrameStats {
    /** Frames counted in the window. */
    frames: number;
    /** Frames per second over the window. */
    fps: number;
    /** Mean frame interval, ms. */
    meanMs: number;
    /** Worst frame interval, ms. */
    maxMs: number;
    /** Frames that missed a 60Hz vsync. */
    dropped: number;
    /** Mean and worst time spent inside our own tick, ms. */
    costMeanMs: number;
    costMaxMs: number;
    /** Peak element writes and contacts in any single frame of the window. */
    writes: number;
    contacts: number;
    /** Interval histogram. */
    buckets: number[];
}

/**
 * Decode a drained buffer. Layout matches `drainStats`:
 * `[frames, sumMs, maxMs, dropped, costSumMs, costMaxMs, peakWrites, peakContacts, ...8 buckets]`.
 */
export function decodeStats(raw: readonly number[], windowMs: number): FrameStats {
    const frames = raw[0] ?? 0;
    const sum = raw[1] ?? 0;
    const costSum = raw[4] ?? 0;
    return {
        frames,
        fps: windowMs > 0 ? (frames * 1000) / windowMs : 0,
        meanMs: frames > 0 ? sum / frames : 0,
        maxMs: raw[2] ?? 0,
        dropped: raw[3] ?? 0,
        costMeanMs: frames > 0 ? costSum / frames : 0,
        costMaxMs: raw[5] ?? 0,
        writes: raw[6] ?? 0,
        contacts: raw[7] ?? 0,
        buckets: raw.slice(8, 16).map((n) => n ?? 0),
    };
}

/**
 * Percentile of the frame interval, interpolated inside the containing bucket.
 *
 * Bucketed rather than exact because the source clock is `Date.now()` at 1ms
 * granularity — keeping every sample would buy precision the clock cannot
 * supply, at a per-frame allocation cost. Interpolating within the bucket is
 * honest about the resolution: the answer is "somewhere in this band", placed
 * proportionally.
 *
 * Returns 0 for an empty window.
 */
export function percentileMs(buckets: readonly number[], p: number): number {
    let total = 0;
    for (const b of buckets) total += b;
    if (total === 0) return 0;

    const target = total * p;
    let seen = 0;
    for (let i = 0; i < buckets.length; i++) {
        const count = buckets[i] ?? 0;
        if (count === 0) continue;
        if (seen + count >= target) {
            const lo = i === 0 ? 0 : BUCKET_EDGES[i - 1]!;
            const hi = i < BUCKET_EDGES.length ? BUCKET_EDGES[i]! : OVERFLOW_EDGE;
            // Where the target falls inside this bucket's share.
            const within = (target - seen) / count;
            return lo + (hi - lo) * within;
        }
        seen += count;
    }
    return OVERFLOW_EDGE;
}

/** Compact one-line summary, e.g. `58fps p50 16.4 p95 24.1 · tick 3.2/9.0ms`. */
export function summarize(s: FrameStats): string {
    if (s.frames === 0) return 'idle';
    const p50 = percentileMs(s.buckets, 0.5);
    const p95 = percentileMs(s.buckets, 0.95);
    return `${Math.round(s.fps)}fps  p50 ${p50.toFixed(1)}  p95 ${p95.toFixed(1)}`
        + `  ·  tick ${s.costMeanMs.toFixed(1)}/${s.costMaxMs.toFixed(1)}ms`;
}

/**
 * Which of the two numbers is the bottleneck.
 *
 * The point of reporting cost and interval separately: if our tick is most of
 * the frame, the JavaScript is the problem; if it is a small fraction of a
 * long frame, the time is going somewhere we don't control.
 */
export function verdict(s: FrameStats): 'idle' | 'ours' | 'native' | 'fine' {
    if (s.frames === 0) return 'idle';
    if (s.meanMs <= 20) return 'fine';
    return s.costMeanMs > s.meanMs * 0.5 ? 'ours' : 'native';
}
