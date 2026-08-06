/**
 * Logical screen dimensions (in dp), live across rotation / window resize.
 *
 * Backed by `useScreen()` — which reads the native `ScreenMetricsPublisher`'s
 * `__globalProps.screen` and follows every viewport change — with a
 * typical-phone fallback for tests / SSR / non-Lynx hosts.
 *
 * These are **functions, not constants** (they were `const`s snapshotted at
 * module load until #856): a transition plan built while the device is in
 * landscape has to slide the full landscape width, so every call site reads at
 * plan-build time. `'main thread'` worklet bodies can't reach the BG signal and
 * use {@link screenWidthMT} / {@link screenHeightMT}, which read
 * `__globalProps` synchronously — same value, same source, no subscription.
 *
 * Used by:
 *   - `<ScreenContainer>` for the slide-from-right (translateX) and
 *     slide-from-bottom (translateY, modal) transform output ranges.
 *   - `<EdgeBackHandle>` for the gesture commit threshold (`dx / width`).
 *
 * Both must agree, otherwise the commit threshold and the animation
 * geometry won't line up. Single shared module avoids drift.
 */

import { useScreen, useScreenMT } from '@sigx/lynx';

/** Current logical screen width (dp). BG-side, reactive. */
export function screenWidth(): number {
    return useScreen().value.width;
}

/** Current logical screen height (dp). BG-side, reactive. */
export function screenHeight(): number {
    return useScreen().value.height;
}

/** Current logical screen width (dp), readable inside a `'main thread'` worklet. */
export function screenWidthMT(): number {
    return useScreenMT().width;
}

/** Current logical screen height (dp), readable inside a `'main thread'` worklet. */
export function screenHeightMT(): number {
    return useScreenMT().height;
}
