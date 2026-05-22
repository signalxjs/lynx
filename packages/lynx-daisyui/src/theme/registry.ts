/**
 * Theme registry — tags each daisy color theme as a light or dark variant so
 * `ThemeProvider` can pick the right one based on system appearance and so
 * `toggle()` can flip between variants without hardcoding the names.
 *
 * Registering a custom theme is a runtime call — see `registerTheme()` below.
 * Order matters for `pickThemeFor()`: the *first* theme of a given variant
 * is the default for that variant when no explicit `light` / `dark` prop is
 * set on `<ThemeProvider>`.
 */

export type ThemeVariant = 'light' | 'dark';

export interface ThemeMeta {
  /** CSS class name applied to the host view (e.g. `'daisy-cupcake'`). */
  name: string;
  /** Whether this theme renders well behind light or dark system bars. */
  variant: ThemeVariant;
  /**
   * Optional pair: which theme should `toggle()` flip to. Defaults to the
   * first theme of the opposite variant. Set this to control which dark
   * theme pairs with a given light one (e.g. cupcake ↔ synthwave).
   */
  pair?: string;
}

const registry: ThemeMeta[] = [
  { name: 'daisy-light', variant: 'light', pair: 'daisy-dark' },
  { name: 'daisy-cupcake', variant: 'light', pair: 'daisy-synthwave' },
  { name: 'daisy-emerald', variant: 'light', pair: 'daisy-dracula' },
  { name: 'daisy-dark', variant: 'dark', pair: 'daisy-light' },
  { name: 'daisy-synthwave', variant: 'dark', pair: 'daisy-cupcake' },
  { name: 'daisy-dracula', variant: 'dark', pair: 'daisy-emerald' },
];

/**
 * All registered themes in insertion order. Returns a shallow copy so
 * callers can't mutate the internal registry by casting the `readonly`
 * away — re-registration goes through `registerTheme()`.
 */
export function listThemes(): readonly ThemeMeta[] {
  return registry.slice();
}

/**
 * Register a custom theme. Call at module-load time before mounting
 * `<ThemeProvider>` so it shows up in `listThemes()` / `pickThemeFor()`.
 * Re-registering the same `name` replaces the existing entry.
 */
export function registerTheme(meta: ThemeMeta): void {
  const i = registry.findIndex((m) => m.name === meta.name);
  if (i >= 0) registry[i] = meta;
  else registry.push(meta);
}

/** The variant of a registered theme, or `undefined` if not registered. */
export function variantOf(name: string | undefined): ThemeVariant | undefined {
  if (!name) return undefined;
  // Support multi-class compositions like 'daisy-light daisy-rounded' by
  // matching the first registered class found in the string.
  for (const part of name.split(/\s+/)) {
    const hit = registry.find((m) => m.name === part);
    if (hit) return hit.variant;
  }
  return undefined;
}

/**
 * Pick a default theme for a given system color scheme. Returns the first
 * registered theme of that variant — `daisy-light` for 'light',
 * `daisy-dark` for 'dark' under the default registry.
 *
 * Falls back to `'daisy-light'` if no theme of the requested variant is
 * registered (shouldn't happen with the seeded registry, but protects
 * apps that clear and re-register).
 */
export function pickThemeFor(scheme: ThemeVariant): string {
  const hit = registry.find((m) => m.variant === scheme);
  return hit?.name ?? 'daisy-light';
}

/**
 * Resolve the paired theme of a given name. Used by `theme.toggle()`:
 * follows `pair` if set, otherwise picks the first theme of the opposite
 * variant. Returns the input unchanged when the theme isn't registered.
 */
export function pairOf(name: string): string {
  for (const part of name.split(/\s+/)) {
    const hit = registry.find((m) => m.name === part);
    if (!hit) continue;
    if (hit.pair) return hit.pair;
    return pickThemeFor(hit.variant === 'light' ? 'dark' : 'light');
  }
  return name;
}
