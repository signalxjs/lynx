/**
 * Theme registry — the single source of truth for daisy themes.
 *
 * A theme is *data*: a name, a light/dark variant, and a full color palette
 * (plus an optional toggle `pair` and roundness overrides). Both rendering and
 * icon tinting read from here — `<ThemeProvider>` applies a theme's `colors`
 * as inline CSS custom properties on its host view (Lynx inherits custom
 * properties to descendants, so component classes resolve `var(--color-*)`),
 * and the icon color resolver reads the same palette for SVG fills (parsed SVG
 * content can't read CSS vars). There is no per-theme CSS or parallel JS
 * palette to keep in sync.
 *
 * The six built-ins are seeded below. Register more — including tenant themes
 * fetched at runtime — with `registerTheme()`, or `extendTheme()` to derive
 * one from a base. Order matters for `pickThemeFor()`: the first theme of a
 * given variant is the follow-system default for that variant.
 *
 * Structural tokens (radius, sizing, component dimensions) are theme-agnostic
 * and ship once in the bundled `.daisy` base class (`styles/themes/tokens.css`);
 * a theme may override roundness via `radius`.
 *
 * Colors are engine-safe strings — hex or `rgb()`. Lynx's CSS engine does not
 * parse `oklch()`, so convert before registering.
 */
import type { DaisyColor } from '../shared/styles.js';

export type ThemeVariant = 'light' | 'dark';

/** Full daisy color palette — every semantic token, no holes. */
export type ThemePalette = Record<DaisyColor, string>;

/** Roundness token overrides. Defaults live in the bundled `.daisy` base. */
export interface ThemeRadius {
  box?: string;
  btn?: string;
  badge?: string;
  tab?: string;
  selector?: string;
  toggle?: string;
}

export interface Theme {
  /** Unique id — also the value of `theme.name`. */
  name: string;
  /** Light or dark — drives follow-system selection and status-bar tint. */
  variant: ThemeVariant;
  /** Complete color palette (all 20 semantic tokens). */
  colors: ThemePalette;
  /**
   * Which theme `toggle()` flips to. Defaults to the first registered theme of
   * the opposite variant.
   */
  pair?: string;
  /** Optional roundness overrides; unspecified tokens fall back to `.daisy`. */
  radius?: ThemeRadius;
}

// Shared status palette — identical across the original built-ins, hoisted to
// avoid repetition. (Themes are free to override any of these.)
const STATUS_LIGHT = {
  'info': '#00b4fa', 'info-content': '#000000',
  'success': '#00a96e', 'success-content': '#000000',
  'warning': '#ffc100', 'warning-content': '#000000',
  'error': '#ff676a', 'error-content': '#000000',
} as const;

const registry: Theme[] = [
  {
    name: 'daisy-light', variant: 'light', pair: 'daisy-dark',
    colors: {
      'primary': '#491dff', 'primary-content': '#d3dbff',
      'secondary': '#ff20cc', 'secondary-content': '#fff8fc',
      'accent': '#00cfbd', 'accent-content': '#00100d',
      'neutral': '#2b3440', 'neutral-content': '#d7dde4',
      'base-100': '#ffffff', 'base-200': '#f2f2f2', 'base-300': '#e5e6e6',
      'base-content': '#1f2937',
      ...STATUS_LIGHT,
    },
  },
  {
    name: 'daisy-cupcake', variant: 'light', pair: 'daisy-synthwave',
    colors: {
      'primary': '#65c3c8', 'primary-content': '#052124',
      'secondary': '#ef9fbc', 'secondary-content': '#2d0a16',
      'accent': '#eeaf3a', 'accent-content': '#2d1c00',
      'neutral': '#291334', 'neutral-content': '#f5f1f8',
      'base-100': '#faf7f5', 'base-200': '#efeae6', 'base-300': '#e7e2df',
      'base-content': '#291334',
      ...STATUS_LIGHT,
    },
  },
  {
    name: 'daisy-emerald', variant: 'light', pair: 'daisy-dracula',
    colors: {
      'primary': '#66cc8a', 'primary-content': '#06200f',
      'secondary': '#377cfb', 'secondary-content': '#02112d',
      'accent': '#f68067', 'accent-content': '#2d0a02',
      'neutral': '#333c4d', 'neutral-content': '#e9eaed',
      'base-100': '#ffffff', 'base-200': '#f3f4f6', 'base-300': '#e5e7eb',
      'base-content': '#333c4d',
      'info': '#1c92f2', 'info-content': '#000a14',
      'success': '#00a96e', 'success-content': '#000a05',
      'warning': '#ff9900', 'warning-content': '#261600',
      'error': '#ff5724', 'error-content': '#000000',
    },
  },
  {
    name: 'daisy-dark', variant: 'dark', pair: 'daisy-light',
    colors: {
      'primary': '#7582ff', 'primary-content': '#050617',
      'secondary': '#ff71cf', 'secondary-content': '#190211',
      'accent': '#00e7d0', 'accent-content': '#001210',
      'neutral': '#2a323c', 'neutral-content': '#a6adbb',
      'base-100': '#1d232a', 'base-200': '#191e24', 'base-300': '#343b46',
      'base-content': '#a6adbb',
      ...STATUS_LIGHT,
    },
  },
  {
    name: 'daisy-synthwave', variant: 'dark', pair: 'daisy-cupcake',
    colors: {
      'primary': '#e779c1', 'primary-content': '#2a0a1f',
      'secondary': '#58c7f3', 'secondary-content': '#02141d',
      'accent': '#f3cc30', 'accent-content': '#2a1f00',
      'neutral': '#20134e', 'neutral-content': '#e3e0f5',
      'base-100': '#2d1b69', 'base-200': '#261159', 'base-300': '#1f0f4a',
      'base-content': '#f9f7fd',
      'info': '#53c0f3', 'info-content': '#02151e',
      'success': '#71ead2', 'success-content': '#002721',
      'warning': '#f3cc30', 'warning-content': '#2a1f00',
      'error': '#e24056', 'error-content': '#ffffff',
    },
  },
  {
    name: 'daisy-dracula', variant: 'dark', pair: 'daisy-emerald',
    colors: {
      'primary': '#ff79c6', 'primary-content': '#2d0414',
      'secondary': '#bd93f9', 'secondary-content': '#160226',
      'accent': '#50fa7b', 'accent-content': '#002a0e',
      'neutral': '#414558', 'neutral-content': '#f8f8f2',
      'base-100': '#282a36', 'base-200': '#21222c', 'base-300': '#181920',
      'base-content': '#f8f8f2',
      'info': '#8be9fd', 'info-content': '#002a31',
      'success': '#50fa7b', 'success-content': '#002a0e',
      'warning': '#f1fa8c', 'warning-content': '#2a2900',
      'error': '#ff5555', 'error-content': '#2a0000',
    },
  },
];

/**
 * Resolve a `theme.name` to its registered `Theme`. Supports multi-class names
 * like `'daisy-light daisy-rounded'` by matching the first registered id found.
 */
function findTheme(name: string | undefined): Theme | undefined {
  if (!name) return undefined;
  for (const part of name.split(/\s+/)) {
    const hit = registry.find((t) => t.name === part);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * All registered themes in insertion order. Returns a shallow copy so callers
 * can't mutate the internal registry — re-registration goes through
 * `registerTheme()`. Each entry is a full `Theme` (name, variant, palette),
 * so consumers can render swatches in a picker.
 */
export function listThemes(): readonly Theme[] {
  return registry.slice();
}

/**
 * Register (or replace, by `name`) a theme. Call at module-load time before
 * mounting `<ThemeProvider>` so it shows up in `listThemes()` / `pickThemeFor()`.
 */
export function registerTheme(theme: Theme): void {
  const i = registry.findIndex((t) => t.name === theme.name);
  if (i >= 0) registry[i] = theme;
  else registry.push(theme);
}

/**
 * Derive a new theme from a registered base, overriding any colors / roundness.
 * Ergonomic for "tenant tweaks a few tokens": the result is a full `Theme` you
 * pass to `registerTheme()`. Throws if `base` isn't registered.
 *
 * ```ts
 * registerTheme(extendTheme('daisy-dark', {
 *   name: 'acme-dark',
 *   colors: { primary: '#fb7185' },
 * }));
 * ```
 */
export function extendTheme(
  base: string,
  patch: {
    name: string;
    variant?: ThemeVariant;
    pair?: string;
    colors?: Partial<ThemePalette>;
    radius?: ThemeRadius;
  },
): Theme {
  const src = findTheme(base);
  if (!src) {
    throw new Error(
      `[lynx-daisyui] extendTheme: unknown base theme "${base}". `
      + `Register it first, or extend a built-in (e.g. 'daisy-light').`,
    );
  }
  return {
    name: patch.name,
    variant: patch.variant ?? src.variant,
    pair: patch.pair ?? src.pair,
    colors: { ...src.colors, ...patch.colors },
    radius: patch.radius ?? src.radius,
  };
}

/** The variant of a registered theme, or `undefined` if not registered. */
export function variantOf(name: string | undefined): ThemeVariant | undefined {
  return findTheme(name)?.variant;
}

/** The color palette of a registered theme, or `undefined` if not registered. */
export function colorsOf(name: string | undefined): ThemePalette | undefined {
  return findTheme(name)?.colors;
}

/** The roundness overrides of a registered theme, if any. */
export function radiusOf(name: string | undefined): ThemeRadius | undefined {
  return findTheme(name)?.radius;
}

/**
 * Pick a default theme for a given system color scheme — the first registered
 * theme of that variant (`daisy-light` / `daisy-dark` under the seeded
 * registry). Falls back to `'daisy-light'` if none of that variant exists.
 */
export function pickThemeFor(scheme: ThemeVariant): string {
  const hit = registry.find((t) => t.variant === scheme);
  return hit?.name ?? 'daisy-light';
}

/**
 * Resolve the paired theme of a given name — used by `theme.toggle()`. Follows
 * `pair` if set, otherwise the first theme of the opposite variant. Returns the
 * input unchanged when the theme isn't registered.
 */
export function pairOf(name: string): string {
  const hit = findTheme(name);
  if (!hit) return name;
  if (hit.pair) return hit.pair;
  return pickThemeFor(hit.variant === 'light' ? 'dark' : 'light');
}
