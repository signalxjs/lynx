/**
 * `useThemeColors()` — resolve the *active, scoped* theme palette to concrete
 * color values for consumers that can't read CSS custom properties.
 *
 * Native widgets are the audience: platform text inputs, `<sigx-richtext>`,
 * SVG fills — anything where `var(--color-*)` never resolves because the
 * value is consumed outside Lynx's CSS pipeline. Components pass these
 * resolved literals via inline `style` or native props instead.
 *
 * Scoped + reactive: resolves through `useTheme()` (the nearest
 * `<ThemeProvider>`'s controller, falling back to the global one), and the
 * getters read `theme.name` — call them inside render and a theme switch
 * recolors the consumer.
 *
 * ```tsx
 * const colors = useThemeColors();
 * return () => (
 *   <input style={{
 *     color: colors.colorOf('base-content'),
 *     '-x-placeholder-color': colors.colorOf('base-content', 0.45),
 *   }} />
 * );
 * ```
 */
import type { ColorToken } from '../contract.js';
import { colorsOf, fallbackPalette } from './registry.js';
import { useTheme } from './ThemeProvider.js';

export interface ThemeColors {
  /**
   * The active palette's value for `token`, normalized to hex — optionally
   * with `alpha` (0–1) appended as a hex byte (`#RRGGBBAA`). Returns `''`
   * when no theme is registered yet (pre-DS-import edge case).
   */
  colorOf(token: ColorToken, alpha?: number): string;
}

export function useThemeColors(): ThemeColors {
  const theme = useTheme();
  return {
    colorOf(token, alpha) {
      // Reading `theme.name` here is what makes call sites reactive.
      const palette = colorsOf(theme.name) ?? fallbackPalette();
      const raw = palette?.[token];
      if (!raw) return '';
      const hex = toHexColor(raw);
      return alpha === undefined ? hex : withAlpha(hex, alpha);
    },
  };
}

/**
 * Normalize an engine-safe palette color to hex — the registry allows
 * `rgb()`/`rgba()` entries, but most native color parsers are hex-only.
 * Unknown notations pass through unchanged.
 */
export function toHexColor(color: string): string {
  const c = color.trim();
  if (c.startsWith('#')) return c;
  const m = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(c);
  if (!m) return c;
  const byte = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  let hex = `#${byte(Number(m[1]))}${byte(Number(m[2]))}${byte(Number(m[3]))}`;
  if (m[4] !== undefined) {
    const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    hex += byte(Math.max(0, Math.min(1, a)) * 255);
  }
  return hex;
}

/**
 * Append an alpha channel (0–1) to a hex color
 * (`#RGB`/`#RRGGBB`/`#RRGGBBAA` → `#RRGGBBAA`). Non-hex input passes
 * through unchanged; non-finite alpha is treated as opaque.
 */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.trim();
  if (!h.startsWith('#')) return h;
  if (!Number.isFinite(alpha)) return h;
  h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const byte = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${h}${byte}`;
}
