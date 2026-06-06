/**
 * Engine-side color mixing.
 *
 * Lynx's CSS engine has no `color-mix()` and can't alpha-compose `var()`
 * colors — but theme palettes are plain JS data, so tints can be computed
 * where the palette lives instead of in CSS. `registerTheme()` uses this to
 * materialize the `*-soft` tokens (see `./registry.ts`).
 *
 * Accepted inputs are the same "engine-safe" color strings themes already
 * use: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)`.
 * Anything else (named colors, `oklch()`, `var()`) is not parseable here —
 * `mixColors` then falls back to the base color unchanged, which degrades to
 * a neutral surface rather than a wrong tint.
 */

type Rgb = readonly [number, number, number];

function parseColor(value: string): Rgb | undefined {
  const v = value.trim();

  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if ([r, g, b].some(Number.isNaN)) return undefined;
      return [r, g, b];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].some(Number.isNaN)) return undefined;
      return [r, g, b];
    }
    return undefined;
  }

  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i.exec(v);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    if ([r, g, b].some((n) => n > 255)) return undefined;
    return [r, g, b];
  }

  return undefined;
}

const toHex = (n: number): string => Math.round(n).toString(16).padStart(2, '0');

/**
 * Mix `ratio` of `color` into `base` (linear sRGB per-channel, like
 * `color-mix(in srgb, color ratio, base)`), returning a hex string. If either
 * input can't be parsed, returns `base` unchanged.
 */
export function mixColors(color: string, base: string, ratio: number): string {
  const fg = parseColor(color);
  const bg = parseColor(base);
  // Non-finite ratios (NaN softMix etc.) are unmixable — fall back to the
  // base rather than emitting `#NaNNaNNaN`.
  if (!fg || !bg || !Number.isFinite(ratio)) return base;
  const t = Math.min(1, Math.max(0, ratio));
  const mix = (i: 0 | 1 | 2) => fg[i] * t + bg[i] * (1 - t);
  return `#${toHex(mix(0))}${toHex(mix(1))}${toHex(mix(2))}`;
}
