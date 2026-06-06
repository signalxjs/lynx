/**
 * Daisy's `<ThemeProvider>` — `@sigx/lynx-zero`'s theme engine plus the
 * daisy-specific seams:
 *
 *   • importing this module (or anything from `@sigx/lynx-daisyui`) seeds the
 *     six built-in daisy themes into the shared registry (`./builtins.ts`);
 *   • the icon color resolver is provided into `@sigx/lynx-icons` so
 *     `<Icon variant="primary">` resolves to the active theme's hex
 *     (SVG fills can't read CSS vars);
 *   • `initial` / `light` / `dark` get `DaisyTheme` autocomplete.
 *
 * Everything else — system-scheme following, nesting, `fontScale`, the
 * runtime `setProperty` variable application — is the engine's; see
 * `@sigx/lynx-zero`'s `ThemeProvider`.
 *
 * Usage:
 *
 * ```tsx
 * import { ThemeProvider, useTheme } from '@sigx/lynx-daisyui';
 *
 * // System-aware (default): picks daisy-light or daisy-dark from the OS,
 * // live-flips when the user toggles dark mode.
 * defineApp(() => () => (
 *     <ThemeProvider>
 *         <App />
 *     </ThemeProvider>
 * ));
 *
 * // Pin a specific theme — ignores system appearance.
 * <ThemeProvider initial="daisy-light">…</ThemeProvider>
 *
 * // Custom light/dark pair under followSystem.
 * <ThemeProvider light="daisy-cupcake" dark="daisy-synthwave">…</ThemeProvider>
 * ```
 */
import { component, defineProvide, type Define } from '@sigx/lynx';
import { useIconColorResolver, type IconColorResolver } from '@sigx/lynx-icons';
import {
    ThemeProvider as ZeroThemeProvider,
    useTheme,
    colorsOf,
    type ColorToken,
} from '@sigx/lynx-zero';
import { DAISY_BUILTIN_THEMES, type DaisyTheme } from './builtins.js';

// Referencing the built-ins keeps the seeding side effect (`./builtins.ts`
// registers them at module load) safe from over-eager treeshaking.
void DAISY_BUILTIN_THEMES;

/**
 * Declaration-merge extension: add a typed `variant` prop to `<Icon>`,
 * `<FaSolidIcon>`, `<LucideIcon>`, etc. Daisy owns the entire concept
 * — `@sigx/lynx-icons` has no notion of variants. Without this merge
 * being in scope (i.e. an app that doesn't depend on daisy), `<Icon
 * variant="…">` is a compile error: the property doesn't exist.
 *
 * The merge fires the moment any consumer imports anything from
 * `@sigx/lynx-daisyui`. No subpath, no extra import dance.
 */
declare module '@sigx/lynx-icons' {
    interface IconPropsExtensions {
        /**
         * Daisy color token applied as the icon's `fill`. Resolved at
         * runtime through `useIconColorResolver` (provided by
         * `<ThemeProvider>`) to the current theme's hex value.
         */
        variant?: ColorToken;
    }
}

/**
 * Bridges the active theme to `@sigx/lynx-icons`. Rendered *inside* the
 * engine's provider so `useTheme()` resolves to that provider's controller —
 * root or nested — and the resolver therefore recolors icons per sub-scope.
 */
const IconThemeBridge = component<Define.Slot<'default'>>(({ slots }) => {
    const theme = useTheme();
    // Reading `theme.name` inside the resolver makes every icon's render
    // re-run when the theme flips.
    const resolver: IconColorResolver = (iconProps) => {
        const variant = (iconProps as { variant?: ColorToken }).variant;
        if (!variant) return undefined;
        // Every theme's palette lives in the registry; fall back to daisy-light
        // if the active theme isn't registered. SVG fills can't read CSS vars,
        // so the resolved hex/rgb is substituted into the fill at render time.
        const palette = colorsOf(theme.name) ?? colorsOf('daisy-light');
        return palette?.[variant];
    };
    defineProvide(useIconColorResolver, () => resolver);
    return () => <>{slots.default?.()}</>;
});

export type ThemeProviderProps =
    /**
     * Pin the initial theme. When set, the provider ignores system
     * appearance until `controller.followSystem()` is called. When
     * omitted, the provider follows the OS color scheme and live-flips
     * with it.
     */
    & Define.Prop<'initial', DaisyTheme, false>
    /**
     * Theme to use when the system color scheme is `'light'`. Defaults to
     * the first registered light theme (`daisy-light`). Only consulted
     * while `followingSystem` is true.
     */
    & Define.Prop<'light', DaisyTheme, false>
    /**
     * Theme to use when the system color scheme is `'dark'`. Defaults to
     * the first registered dark theme (`daisy-dark`). Only consulted
     * while `followingSystem` is true.
     */
    & Define.Prop<'dark', DaisyTheme, false>
    /**
     * Initial global text-scale multiplier (`1` = default ramp). Seeds the
     * controller's `fontScale`; change it later via `controller.setFontScale()`.
     * On the root provider an explicit value wins over any scale a headless
     * caller set before mount.
     */
    & Define.Prop<'fontScale', number, false>
    /** Extra classes appended to the theme class on the host view. */
    & Define.Prop<'class', string, false>
    /** Extra inline style on the host view. Merged after the base flex-fill defaults. */
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Slot<'default'>;

export const ThemeProvider = component<ThemeProviderProps>(({ props, slots }) => {
    return () => (
        <ZeroThemeProvider
            initial={props.initial}
            light={props.light}
            dark={props.dark}
            fontScale={props.fontScale}
            class={props.class}
            style={props.style}
        >
            <IconThemeBridge>{slots.default?.()}</IconThemeBridge>
        </ZeroThemeProvider>
    );
});

export type { DaisyTheme } from './builtins.js';

// Re-export the engine's theme API so consumers only need `@sigx/lynx-daisyui`.
export {
    useTheme,
    listThemes,
    registerTheme,
    extendTheme,
    pickThemeFor,
    pairOf,
    variantOf,
    colorsOf,
    radiusOf,
    sizesOf,
} from '@sigx/lynx-zero';
export type {
    ThemeController,
    Theme,
    ThemePalette,
    ThemeRadius,
    ThemeSizes,
    ThemeVariant,
} from '@sigx/lynx-zero';
