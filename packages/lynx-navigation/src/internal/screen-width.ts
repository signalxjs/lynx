/**
 * Logical screen width (in dp) read from `lynx.SystemInfo` at module load.
 * Falls back to 400 (typical phone) if SystemInfo isn't available — module
 * load happens BG-side after the bundle initializes, by which time
 * `lynx.SystemInfo` is populated, so the fallback only fires in tests / SSR /
 * non-Lynx hosts.
 *
 * Used by:
 *   - `<ScreenContainer>` for the slide-from-right transform output range.
 *   - `<EdgeBackHandle>` for the gesture commit threshold (`dx / width`).
 *
 * Both must agree, otherwise the commit threshold and the animation
 * geometry won't line up. Single shared constant avoids drift.
 */

declare const lynx:
    | { SystemInfo?: { pixelWidth?: number; pixelRatio?: number } }
    | undefined;

function readScreenWidth(): number {
    try {
        const info = typeof lynx !== 'undefined' ? lynx?.SystemInfo : undefined;
        const pw = info?.pixelWidth;
        const pr = info?.pixelRatio || 1;
        if (typeof pw === 'number' && pw > 0) {
            return Math.round(pw / pr);
        }
    } catch {
        // Lynx globals not present (test env / SSR) — use fallback.
    }
    return 400;
}

export const SCREEN_WIDTH = readScreenWidth();
