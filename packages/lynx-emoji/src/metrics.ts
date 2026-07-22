import { Platform, type PlatformOS } from '@sigx/lynx';

/**
 * Fraction of the declared `fontSize` a platform's emoji font visibly INKS.
 *
 * All grid spacing models the visible ink, not the em box — but the ink is a
 * FONT metric, not a constant (#761): Noto Color Emoji (Android) insets its
 * glyphs to ~64% of the em (device-matched against WhatsApp, #674), while
 * Apple Color Emoji inks ~93% of it. This is a raster property — layout APIs
 * report near-identical font metrics for both, so it cannot be probed at
 * runtime; per-platform calibration IS the measurement.
 *
 * Unknown platforms (web hosts vary their emoji font) get the HIGH bucket:
 * overestimating ink degrades to airy spacing, underestimating to overlap.
 */
export const emojiInkFor = (os: PlatformOS): number =>
    os === 'android' ? 0.64 : 0.93;

/**
 * Ink ratio for the running platform. Read lazily (never at module load) so
 * tests can substitute `Platform` before the first geometry resolution.
 */
export const emojiInkRatio = (): number => emojiInkFor(Platform.OS);

/**
 * Row height (px) a cell of em size `size` occupies: the glyph's visible ink
 * (`size * ink`) plus 9px of air — row spacing tracks what the eye sees, not
 * the font metric (WhatsApp-dense). Pure core of {@link emojiRowPx}; the same
 * `ink` MUST feed the geometry and every row height or the sectioned grid's
 * est == actual scroll-offset contract breaks (#663).
 */
export const emojiRowPxFor = (ink: number, size?: number): number =>
    Math.round((size ?? 32) * ink) + 9;

/**
 * Platform-aware row height for a cell of em size `size` — simultaneously the
 * cell's `estimated-main-axis-size-px`, its pinned height, and the exact
 * per-row height the sectioned grid's scroll-offset math uses (est == actual
 * by construction; padding-derived heights drifted — #663 device gate).
 */
export const emojiRowPx = (size?: number): number =>
    emojiRowPxFor(emojiInkRatio(), size);

/**
 * Screen-adaptive grid geometry (the WhatsApp model, #669/#674): fit as many
 * ~40px cells as `regionWidth` allows (that's the column count, clamped 7–12),
 * then size the glyph em so its visible ink covers ~93% of the resulting cell.
 *
 * The em clamps are anchored in VISUAL ink px (15.36–46.08 — exactly the
 * historical 24–72 em clamp at Android's 0.64 ink), so density bounds match
 * across platforms. On near-em platforms (`ink >= 0.85`) the em is
 * additionally capped at the cell width — a too-low table entry then degrades
 * to airy spacing, never overlap (#761). Android is exempt BY DESIGN: its
 * dense look requires the em to overshoot the cell (Noto's inset absorbs it).
 *
 * Explicit overrides win their half each and are never clamped.
 */
export function resolveEmojiGeometry(
    regionWidth: number,
    ink: number,
    overrides?: { columns?: number; cellSize?: number },
): { columns: number; cellSize: number } {
    const columns = overrides?.columns
        ?? Math.min(12, Math.max(7, Math.floor(regionWidth / 40)));
    const cellW = regionWidth / columns;
    const minEm = Math.round(15.36 / ink);
    const maxEm = Math.round(46.08 / ink);
    const fitEm = ink >= 0.85 ? Math.floor(cellW) : Infinity;
    const cellSize = overrides?.cellSize
        ?? Math.min(maxEm, fitEm, Math.max(minEm, Math.round((cellW * 0.93) / ink)));
    return { columns, cellSize };
}
