/**
 * Logical screen dimensions (in dp), derived from `Platform` (which reads
 * `lynx.SystemInfo` once at load). Falls back to typical phone values when
 * SystemInfo isn't available — module load happens BG-side after the bundle
 * initializes, by which time SystemInfo is populated, so the fallback only
 * fires in tests / SSR / non-Lynx hosts.
 *
 * Used by:
 *   - `<ScreenContainer>` for the slide-from-right (translateX) and
 *     slide-from-bottom (translateY, modal) transform output ranges.
 *   - `<EdgeBackHandle>` for the gesture commit threshold (`dx / width`).
 *
 * Both must agree, otherwise the commit threshold and the animation
 * geometry won't line up. Single shared module avoids drift.
 */

import { Platform } from '@sigx/lynx';

function readDp(px: number, fallback: number): number {
    // `px` is 0 when SystemInfo is unavailable (test env / SSR / non-Lynx host).
    if (px > 0) {
        return Math.round(px / (Platform.pixelRatio || 1));
    }
    return fallback;
}

export const SCREEN_WIDTH = readDp(Platform.pixelWidth, 400);
export const SCREEN_HEIGHT = readDp(Platform.pixelHeight, 800);
