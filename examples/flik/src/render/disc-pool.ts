/**
 * The element-ref pool the simulation writes through.
 *
 * Allocated ONCE at `MAX_DISCS` and owned above the disc layer, for two
 * reasons. The frame worklet captures the array and a capture is resolved
 * exactly once on the main thread, so its identity has to survive every
 * disc-count change and (in a later PR) every render-mode switch. And
 * allocating refs on a count change would push hundreds of `INIT_MT_REF` ops
 * through the bridge mid-game.
 *
 * ### On capturing an array of refs
 *
 * `sanitizeCaptured` only converts top-level `MainThreadRef` instances to
 * their `{_wvid, _initValue}` wire form, so the ones nested in this array
 * cross as JSON'd class instances instead. That still works: `_wvid` is an own
 * enumerable field so it survives `JSON.stringify`, and upstream's capture
 * walker recurses and resolves anything carrying a `_wvid`. It is a path this
 * repo hadn't exercised before, though — if it ever breaks, the fallback is
 * `lynx.querySelectorAll('.flik-disc')` on the main thread, which is arguably
 * the better design at 400 discs anyway since it drops refs from the picture
 * entirely.
 */

import { useMainThreadRef, type MainThread, type MainThreadRef } from '@sigx/lynx';

/** Must match `MAX_DISCS` in useSimLoop.ts — pool slots and array slots pair up. */
export const POOL_SIZE = 400;

export type DiscPool = Array<MainThreadRef<MainThread.Element | null>>;

/**
 * Slot `i` is SIMULATION slot `i`, not disc id `i` — the simulation packs live
 * discs contiguously, so the two coincide only until the first burn-out.
 */
export function useDiscPool(): DiscPool {
    const pool: DiscPool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
        pool.push(useMainThreadRef<MainThread.Element | null>(null));
    }
    return pool;
}
