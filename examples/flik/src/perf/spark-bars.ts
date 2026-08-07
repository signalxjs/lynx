/**
 * The sparkline's element pool.
 *
 * Same reasoning as the disc pool: the frame worklet captures this array and a
 * capture is resolved exactly once on the main thread, so its identity has to
 * outlive every re-render. Allocated at setup and never rebuilt.
 */

import { useMainThreadRef, type MainThread, type MainThreadRef } from '@sigx/lynx';

/** One second of frames at 60Hz. */
export const SPARK_BARS = 60;

export type SparkBars = Array<MainThreadRef<MainThread.Element | null>>;

export function useSparkBars(): SparkBars {
    const bars: SparkBars = [];
    for (let i = 0; i < SPARK_BARS; i++) {
        bars.push(useMainThreadRef<MainThread.Element | null>(null));
    }
    return bars;
}
