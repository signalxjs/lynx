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
import { component, type Define } from '@sigx/lynx';
import { ThemeProvider as ZeroThemeProvider } from '@sigx/lynx-zero';
import { DAISY_BUILTIN_THEMES, type DaisyTheme } from './builtins.js';

// Referencing the built-ins keeps the seeding side effect (`./builtins.ts`
// registers them at module load) safe from over-eager treeshaking.
void DAISY_BUILTIN_THEMES;

// The `<Icon variant>` typed prop and its theme-driven color resolver now live
// in `@sigx/lynx-zero`'s `<ThemeProvider>` (#324) — design-system-agnostic, so
// daisy inherits both by wrapping it. Nothing icon-specific to declare here.

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
            {slots.default?.()}
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
