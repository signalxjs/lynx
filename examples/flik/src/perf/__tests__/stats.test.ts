import { describe, it, expect } from 'vitest';

import { BUCKET_EDGES, decodeStats, percentileMs, summarize, verdict } from '../stats';

/** Build a drain buffer the way `drainStats` lays one out. */
function raw(o: Partial<{
    frames: number; sum: number; max: number; dropped: number;
    costSum: number; costMax: number; writes: number; contacts: number;
    buckets: number[];
}>): number[] {
    return [
        o.frames ?? 0, o.sum ?? 0, o.max ?? 0, o.dropped ?? 0,
        o.costSum ?? 0, o.costMax ?? 0, o.writes ?? 0, o.contacts ?? 0,
        ...(o.buckets ?? [0, 0, 0, 0, 0, 0, 0, 0]),
    ];
}

describe('decodeStats', () => {
    it('turns counters into rates over the window', () => {
        const s = decodeStats(raw({ frames: 30, sum: 500, costSum: 90 }), 500);
        expect(s.fps).toBe(60);
        expect(s.meanMs).toBeCloseTo(500 / 30, 6);
        expect(s.costMeanMs).toBeCloseTo(3, 6);
    });

    it('does not divide by zero on an idle window', () => {
        const s = decodeStats(raw({}), 500);
        expect(s.fps).toBe(0);
        expect(s.meanMs).toBe(0);
        expect(s.costMeanMs).toBe(0);
    });

    it('carries the histogram through', () => {
        const b = [1, 2, 3, 4, 5, 6, 7, 8];
        expect(decodeStats(raw({ buckets: b }), 500).buckets).toEqual(b);
    });

    it('survives a truncated buffer rather than producing NaN', () => {
        const s = decodeStats([5, 80], 500);
        expect(Number.isFinite(s.meanMs)).toBe(true);
        expect(s.buckets).toEqual([]);
    });
});

describe('percentileMs', () => {
    it('is 0 for an empty window', () => {
        expect(percentileMs([0, 0, 0, 0, 0, 0, 0, 0], 0.5)).toBe(0);
    });

    it('lands inside the bucket that contains the target', () => {
        // Everything in bucket 2, which spans (12, 17].
        const p = percentileMs([0, 0, 100, 0, 0, 0, 0, 0], 0.5);
        expect(p).toBeGreaterThan(BUCKET_EDGES[1]!);
        expect(p).toBeLessThanOrEqual(BUCKET_EDGES[2]!);
    });

    it('interpolates within the bucket rather than snapping to an edge', () => {
        // Half of a single bucket's samples ⇒ the midpoint of (12, 17].
        expect(percentileMs([0, 0, 10, 0, 0, 0, 0, 0], 0.5)).toBeCloseTo(14.5, 6);
        expect(percentileMs([0, 0, 10, 0, 0, 0, 0, 0], 0.1)).toBeCloseTo(12.5, 6);
    });

    it('is monotonic in p', () => {
        const b = [2, 5, 20, 8, 3, 1, 1, 0];
        let prev = -1;
        for (const p of [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
            const v = percentileMs(b, p);
            expect(v).toBeGreaterThanOrEqual(prev);
            prev = v;
        }
    });

    it('separates a good window from a janky one', () => {
        const good = [0, 4, 90, 6, 0, 0, 0, 0];
        const janky = [0, 0, 40, 10, 10, 20, 15, 5];
        expect(percentileMs(janky, 0.95)).toBeGreaterThan(percentileMs(good, 0.95) * 1.5);
    });

    it('reports the overflow bucket above the last edge', () => {
        expect(percentileMs([0, 0, 0, 0, 0, 0, 0, 10], 0.5))
            .toBeGreaterThanOrEqual(BUCKET_EDGES[BUCKET_EDGES.length - 1]!);
    });

    it('handles a p of 1 without running off the end', () => {
        expect(Number.isFinite(percentileMs([1, 1, 1, 0, 0, 0, 0, 0], 1))).toBe(true);
    });
});

describe('verdict — which number is the bottleneck', () => {
    it('says fine while frames are on time', () => {
        expect(verdict(decodeStats(raw({ frames: 60, sum: 1000, costSum: 200 }), 1000)))
            .toBe('fine');
    });

    it('blames our own tick when it eats most of a long frame', () => {
        // 30 frames of 33ms, 28ms of it ours.
        const s = decodeStats(raw({ frames: 30, sum: 990, costSum: 840 }), 1000);
        expect(verdict(s)).toBe('ours');
    });

    it('blames native when the frame is long but our tick is short', () => {
        // The divergence that says the time is going somewhere we don't control.
        const s = decodeStats(raw({ frames: 30, sum: 990, costSum: 120 }), 1000);
        expect(verdict(s)).toBe('native');
    });

    it('says idle when nothing ran', () => {
        expect(verdict(decodeStats(raw({}), 500))).toBe('idle');
    });
});

describe('summarize', () => {
    it('reports idle rather than a row of zeroes', () => {
        expect(summarize(decodeStats(raw({}), 500))).toBe('idle');
    });

    it('includes both the interval percentiles and the tick cost', () => {
        const s = decodeStats(
            raw({ frames: 60, sum: 1000, costSum: 180, costMax: 9, buckets: [0, 10, 40, 10, 0, 0, 0, 0] }),
            1000,
        );
        const out = summarize(s);
        expect(out).toMatch(/fps/);
        expect(out).toMatch(/p50/);
        expect(out).toMatch(/p95/);
        expect(out).toMatch(/tick/);
    });
});
