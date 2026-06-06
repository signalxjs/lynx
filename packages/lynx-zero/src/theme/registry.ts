/**
 * Theme registry — the single source of truth for registered themes.
 *
 * A theme is *data*: a name, a light/dark variant, and a full color palette
 * (plus an optional toggle `pair` and roundness overrides). Both rendering and
 * any DS-specific consumers (e.g. icon tinting) read from here —
 * `<ThemeProvider>` applies a theme's `colors` as inline CSS custom properties
 * on its host view (Lynx inherits custom properties to descendants, so
 * component classes resolve `var(--color-*)`). There is no per-theme CSS or
 * parallel JS palette to keep in sync.
 *
 * The registry starts **empty** — design-system packages seed it at module
 * load (e.g. `@sigx/lynx-daisyui` registers its six built-ins on import).
 * Register more — including tenant themes fetched at runtime — with
 * `registerTheme()`, or `extendTheme()` to derive one from a base. Order
 * matters for `pickThemeFor()`: the first theme of a given variant is the
 * follow-system default for that variant.
 *
 * Structural tokens (radius, sizing, component dimensions) are theme-agnostic
 * and ship once in the bundled `.lynx-zero` base class (`styles/tokens.css`);
 * a theme may override roundness via `radius` and base size units via `sizes`.
 *
 * Colors are engine-safe strings — hex or `rgb()`. Lynx's CSS engine does not
 * parse `oklch()`, so convert before registering.
 */
import type { ColorToken } from '../contract.js';

export type ThemeVariant = 'light' | 'dark';

/** Full color palette — every semantic token, no holes. */
export type ThemePalette = Record<ColorToken, string>;

/**
 * Roundness token overrides. Emitted as `--radius-selector` /
 * `--radius-field` / `--radius-box`. Defaults live in the bundled
 * `.lynx-zero` base.
 */
export interface ThemeRadius {
  /** Small selectable controls — checkbox, toggle, badge. */
  selector?: string;
  /** Fields — button, input, select, textarea. */
  field?: string;
  /** Boxes — card, modal, alert. */
  box?: string;
}

/**
 * Base size-unit overrides. Emitted as `--size-selector` / `--size-field`;
 * component dimensions are integer multiples of these. Defaults live in the
 * bundled `.lynx-zero` base.
 */
export interface ThemeSizes {
  /** Base unit for selector controls (checkbox, toggle, badge). */
  selector?: string;
  /** Base unit for fields (button, input, select). */
  field?: string;
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
  /** Optional roundness overrides; unspecified tokens fall back to the base. */
  radius?: ThemeRadius;
  /** Optional base size-unit overrides; unspecified tokens fall back to the base. */
  sizes?: ThemeSizes;
  /**
   * Whether this theme ships a build-time CSS class named after it (the DS
   * package generates `.theme-name { --color-*: … }` at build time, e.g. via
   * daisyui's `gen-theme-css.mjs`). Such themes paint correctly on the very
   * first frame; themes without it apply via the runtime `setProperty` path
   * post-mount, with their variant's static theme class as the first-frame
   * fallback.
   */
  staticCss?: boolean;
}

const registry: Theme[] = [];

/**
 * Whether `name` is a registered theme that ships a build-time CSS class —
 * i.e. it paints correctly on the first frame. Themes registered without
 * `staticCss` return `false`; `<ThemeProvider>` falls back to their variant's
 * static class for first paint and swaps in the exact palette via
 * `setProperty`.
 */
export function hasStaticCss(name: string | undefined): boolean {
  return findTheme(name)?.staticCss === true;
}

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
    sizes?: ThemeSizes;
  },
): Theme {
  const src = findTheme(base);
  if (!src) {
    throw new Error(
      `[lynx-zero] extendTheme: unknown base theme "${base}". `
      + `Register it first, or extend one your design system registered.`,
    );
  }
  return {
    name: patch.name,
    variant: patch.variant ?? src.variant,
    pair: patch.pair ?? src.pair,
    colors: { ...src.colors, ...patch.colors },
    radius: patch.radius ?? src.radius,
    sizes: patch.sizes ?? src.sizes,
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

/** The base size-unit overrides of a registered theme, if any. */
export function sizesOf(name: string | undefined): ThemeSizes | undefined {
  return findTheme(name)?.sizes;
}

/**
 * The first registered palette — the engine's last-resort fallback when an
 * active theme name isn't registered. `undefined` only when no design system
 * has seeded the registry yet.
 * @internal
 */
export function fallbackPalette(): ThemePalette | undefined {
  return registry[0]?.colors;
}

/**
 * Pick a default theme for a given system color scheme — the first registered
 * theme of that variant. Falls back to the first registered theme of any
 * variant, or `''` while the registry is empty (a design-system package seeds
 * it at module load, so this is only reachable before any DS import).
 */
export function pickThemeFor(scheme: ThemeVariant): string {
  const hit = registry.find((t) => t.variant === scheme);
  return hit?.name ?? registry[0]?.name ?? '';
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
