/**
 * The custom properties a theme resolves to — the single derivation shared by
 * both ways a palette reaches the screen.
 *
 * `<ThemeProvider>` calls this to declare a theme inline on its host view (the
 * path every runtime-registered theme takes), and the design-system packages'
 * `gen-theme-css.mjs` calls the *same* function at build time to emit the
 * `.theme-name { … }` stylesheet rules for their built-ins (#985). Keeping one
 * implementation is the point: a theme must resolve to the same tokens whether
 * the CSS engine or the inline transport delivers it.
 *
 * Two engine constraints shape everything here:
 *
 * - **No `calc(var() * n)`.** Component dimensions are integer multiples of two
 *   base units (`--size-field`, `--size-selector`), but Lynx's runtime CSS
 *   engine is unproven for arithmetic over custom properties, so a theme that
 *   overrides a base unit gets the multiplication done here and emits literal
 *   px. A non-px base sets only the base var and leaves the `.lynx-zero`
 *   defaults in place.
 * - **No var→var indirection.** Every value is a literal.
 */
import type { ThemePalette, ThemeRadius, ThemeSizes } from './registry.js';

/** Field sizes as multiples of `--size-field`. Mirrors `styles/tokens.css`. */
const FIELD_STEPS: Record<string, number> = { xs: 6, sm: 8, md: 12, lg: 16 };

/** Selector-driven sizes as multiples of `--size-selector`. Mirrors `styles/tokens.css`. */
const SELECTOR_STEPS: Record<string, number> = {
    'checkbox-xs': 4, 'checkbox-sm': 5, 'checkbox-md': 6, 'checkbox-lg': 8,
    'toggle-width-xs': 8, 'toggle-width-sm': 10, 'toggle-width-md': 12, 'toggle-width-lg': 14,
    'toggle-height-xs': 6, 'toggle-height-sm': 6, 'toggle-height-md': 7, 'toggle-height-lg': 8,
    'toggle-thumb-xs': 4, 'toggle-thumb-sm': 4, 'toggle-thumb-md': 5, 'toggle-thumb-lg': 6,
    'badge-xs': 4, 'badge-sm': 5, 'badge-md': 6, 'badge-lg': 8,
};

/**
 * Default text ramp (px) — MUST mirror `--text-*` in `styles/tokens.css`
 * (iOS-aligned, 17px base). The global `fontScale` multiplies these.
 */
const FONT_DEFAULTS: Record<string, number> = {
    'xs': 12, 'sm': 14, 'base': 17, 'lg': 20, 'xl': 24, '2xl': 28, '3xl': 34,
};

const pxValue = (v: string): number | undefined => {
    const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(v);
    return m ? Number(m[1]) : undefined;
};

/** Emit a theme's `sizes` overrides as literal-px custom properties. */
function applySizeVars(
    out: Record<string, string>,
    sizes: ThemeSizes,
): void {
    if (sizes.field) {
        out['--size-field'] = sizes.field;
        const base = pxValue(sizes.field);
        if (base !== undefined) {
            for (const k in FIELD_STEPS) out[`--size-${k}`] = `${base * FIELD_STEPS[k]}px`;
        }
    }
    if (sizes.selector) {
        out['--size-selector'] = sizes.selector;
        const base = pxValue(sizes.selector);
        if (base !== undefined) {
            for (const k in SELECTOR_STEPS) out[`--${k}`] = `${base * SELECTOR_STEPS[k]}px`;
        }
    }
}

/** The theme-data slice `themeCustomProperties` needs. */
export interface ThemeTokenSource {
    colors?: ThemePalette;
    radius?: ThemeRadius;
    sizes?: ThemeSizes;
}

/**
 * Every custom property a theme declares that does **not** depend on runtime
 * state: the full color palette (including the materialized `*-soft` tints),
 * any roundness overrides, and any base-size overrides with their derived
 * component dimensions.
 *
 * Deliberately excludes the `--text-*` ramp — that one is scaled by the
 * controller's `fontScale` at runtime, so it can't live in a stylesheet. See
 * {@link textRampVars}.
 */
export function themeCustomProperties(
    theme: ThemeTokenSource,
): Record<string, string> {
    const out: Record<string, string> = {};
    if (theme.colors) {
        for (const key in theme.colors) out[`--color-${key}`] = theme.colors[key as keyof ThemePalette];
    }
    if (theme.radius) {
        if (theme.radius.selector) out['--radius-selector'] = theme.radius.selector;
        if (theme.radius.field) out['--radius-field'] = theme.radius.field;
        if (theme.radius.box) out['--radius-box'] = theme.radius.box;
    }
    if (theme.sizes) applySizeVars(out, theme.sizes);
    return out;
}

/**
 * The text ramp scaled by `fontScale`, as literal px.
 *
 * Only worth emitting when the scale isn't `1`: at `1` these are exactly the
 * literals `.lynx-zero` already declares, and a class declaration on the
 * element beats any ramp inherited from an enclosing scaled provider — so the
 * defaults shadow correctly on their own.
 */
export function textRampVars(fontScale: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k in FONT_DEFAULTS) {
        out[`--text-${k}`] = `${Math.round(FONT_DEFAULTS[k] * fontScale)}px`;
    }
    return out;
}
