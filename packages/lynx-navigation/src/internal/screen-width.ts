/**
 * Logical screen dimensions (in dp) read from `lynx.SystemInfo` at module
 * load. Falls back to typical phone values if SystemInfo isn't available —
 * module load happens BG-side after the bundle initializes, by which time
 * `lynx.SystemInfo` is populated, so the fallback only fires in tests /
 * SSR / non-Lynx hosts.
 *
 * Used by:
 *   - `<ScreenContainer>` for the slide-from-right (translateX) and
 *     slide-from-bottom (translateY, modal) transform output ranges.
 *   - `<EdgeBackHandle>` for the gesture commit threshold (`dx / width`).
 *
 * Both must agree, otherwise the commit threshold and the animation
 * geometry won't line up. Single shared module avoids drift.
 */

declare const lynx:
    | {
        SystemInfo?: {
            pixelWidth?: number;
            pixelHeight?: number;
            pixelRatio?: number;
        };
    }
    | undefined;

function readDp(prop: 'pixelWidth' | 'pixelHeight', fallback: number): number {
    try {
        const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
        const px = info?.[prop];
        const pr = info?.pixelRatio || 1;
        if (typeof px === 'number' && px > 0) {
            return Math.round(px / pr);
        }
    } catch {
        // Lynx globals not present (test env / SSR) — use fallback.
    }
    return fallback;
}

export const SCREEN_WIDTH = readDp('pixelWidth', 400);
export const SCREEN_HEIGHT = readDp('pixelHeight', 800);
