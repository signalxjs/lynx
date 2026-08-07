/**
 * The sparkline's element pool.
 *
 * Same reasoning as the disc pool: the frame worklet captures this array and a
 * capture is resolved exactly once on the main thread, so its identity has to
 * outlive every re-render. Allocated at setup and never rebuilt.
 */

import { useMainThreadRef, type MainThread, type MainThreadRef } from '@sigx/lynx';

/**
 * Bars in the sparkline. Sized to fit the header's centre column rather than
 * to a round number of seconds — at 120Hz this is under half a second of
 * history, which is enough to see a hitch land and is all the width there is.
 * The worklet indexes by `frames % bars.length`, so this is the only place the
 * count is stated.
 */
export const SPARK_BARS = 44;

export type SparkBars = Array<MainThreadRef<MainThread.Element | null>>;

export function useSparkBars(): SparkBars {
    const bars: SparkBars = [];
    for (let i = 0; i < SPARK_BARS; i++) {
        bars.push(useMainThreadRef<MainThread.Element | null>(null));
    }
    return bars;
}
