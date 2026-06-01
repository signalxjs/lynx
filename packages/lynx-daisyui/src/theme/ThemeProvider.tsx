/**
 * `<ThemeProvider>` and `useTheme()` — daisyui theme switching for
 * `@sigx/lynx-daisyui`.
 *
 * Themes are CSS classes containing scoped `--color-*` / `--radius-*`
 * variable definitions; descendants of an element with the class inherit
 * those variables (Lynx has `enableCSSInheritance: true` in its
 * layout-pipeline defaults), and the daisyui components are built to read
 * those vars directly.
 *
 * Six color themes ship in the box (`daisy-light`, `daisy-dark`,
 * `daisy-cupcake`, `daisy-emerald`, `daisy-synthwave`, `daisy-dracula`)
 * plus style modifier themes (`daisy-rounded`, `daisy-flat`). Custom themes
 * register their light/dark variant via `registerTheme()` in
 * `./registry.ts` so `followSystem` and `toggle()` know what to pick.
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
import {
    component,
    defineInjectable,
    defineProvide,
    effect,
    onMounted,
    onUnmounted,
    signal,
    untrack,
    type Define,
} from '@sigx/lynx';
import { useIconColorResolver, type IconColorResolver } from '@sigx/lynx-icons';
import { useSystemColorScheme } from '@sigx/lynx-appearance';
import type { ColorScheme } from '@sigx/lynx-appearance';
import type { DaisyColor } from '../shared/styles.js';
import {
    colorsOf,
    isBuiltInTheme,
    pickThemeFor,
    radiusOf,
    sizesOf,
    variantOf,
} from './registry.js';
import type { ThemeSizes } from './registry.js';
import {
    globalThemeState,
    makeThemeController,
    themeController,
    type ThemeState,
} from './theme-state.js';

// Lynx background-thread runtime global (closure-injected by the runtime; not
// typed in this package's tsconfig). We use only its CSS-variable setter — the
// documented way to apply theme variables at runtime.
declare const lynx: {
    getElementById(id: string): { setProperty(props: Record<string, string>): void } | null;
} | undefined;

// DaisyUI v5 expresses control dimensions as multiples of two base units
// (`--size-field`, `--size-selector`). Lynx's runtime CSS engine is unproven
// for `calc(var() * n)`, so when a theme overrides a base unit we do the
// multiplication here and emit literal px. Bases must be px (engine-safe, like
// colors); a non-px base sets only the base var and leaves the `.daisy`
// defaults in place. Multiples mirror the defaults in `styles/themes/tokens.css`.
const FIELD_STEPS: Record<string, number> = { xs: 6, sm: 8, md: 12, lg: 16 };
const SELECTOR_STEPS: Record<string, number> = {
    'checkbox-xs': 4, 'checkbox-sm': 5, 'checkbox-md': 6, 'checkbox-lg': 8,
    'toggle-width-xs': 8, 'toggle-width-sm': 10, 'toggle-width-md': 12, 'toggle-width-lg': 14,
    'toggle-height-xs': 6, 'toggle-height-sm': 6, 'toggle-height-md': 7, 'toggle-height-lg': 8,
    'toggle-thumb-xs': 4, 'toggle-thumb-sm': 4, 'toggle-thumb-md': 5, 'toggle-thumb-lg': 6,
    'badge-xs': 4, 'badge-sm': 5, 'badge-md': 6, 'badge-lg': 8,
};

// Default text ramp (px) — mirrors `--text-*` in `styles/themes/tokens.css`.
// The global `fontScale` multiplies these and emits literal px (no
// `calc(var() * n)` — unproven in Lynx); `fontScale === 1` leaves the `.daisy`
// defaults in place.
const FONT_DEFAULTS: Record<string, number> = {
    'xs': 12, 'sm': 14, 'base': 16, 'lg': 18, 'xl': 20, '2xl': 24, '3xl': 30,
};

const pxValue = (v: string): number | undefined => {
    const m = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(v);
    return m ? Number(m[1]) : undefined;
};

/** Emit a theme's `sizes` overrides as literal-px CSS custom properties. */
function applySizeVars(
    style: Record<string, string | number>,
    sizes: ThemeSizes,
): void {
    if (sizes.field) {
        style['--size-field'] = sizes.field;
        const base = pxValue(sizes.field);
        if (base !== undefined) {
            for (const k in FIELD_STEPS) style[`--size-${k}`] = `${base * FIELD_STEPS[k]}px`;
        }
    }
    if (sizes.selector) {
        style['--size-selector'] = sizes.selector;
        const base = pxValue(sizes.selector);
        if (base !== undefined) {
            for (const k in SELECTOR_STEPS) style[`--${k}`] = `${base * SELECTOR_STEPS[k]}px`;
        }
    }
}

/**
 * Emit the text ramp scaled by `fontScale` as `--text-*` literal px. A no-op at
 * `1` so the `.daisy` defaults (and first-paint CSS class) stand; any other
 * value overrides every step. Inherits to descendants — including nested
 * `<ThemeProvider>`s that don't set their own scale — via Lynx CSS inheritance.
 */
function applyFontScale(
    style: Record<string, string | number>,
    fontScale: number,
): void {
    if (fontScale === 1) return;
    for (const k in FONT_DEFAULTS) {
        style[`--text-${k}`] = `${Math.round(FONT_DEFAULTS[k] * fontScale)}px`;
    }
}

/**
 * The full custom-property set for a theme — colors, any radius/size overrides,
 * and the `fontScale`-adjusted text ramp. Applied at runtime via the Lynx
 * `setProperty` API (see
 * `<ThemeProvider>`), NOT the inline `style` attribute: Lynx does not honor
 * custom properties declared inline in this toolchain, but `setProperty`
 * registers real, inheritable ones — the documented way to theme via CSS
 * variables (https://lynxjs.org/guide/styling/custom-theming).
 */
function buildThemeVars(name: string, fontScale: number): Record<string, string> {
    const palette = colorsOf(name) ?? colorsOf('daisy-light')!;
    const radius = radiusOf(name);
    const sizes = sizesOf(name);
    const vars: Record<string, string> = {};
    for (const key in palette) vars[`--color-${key}`] = palette[key as DaisyColor];
    if (radius) {
        if (radius.selector) vars['--radius-selector'] = radius.selector;
        if (radius.field) vars['--radius-field'] = radius.field;
        if (radius.box) vars['--radius-box'] = radius.box;
    }
    if (sizes) applySizeVars(vars, sizes);
    applyFontScale(vars, fontScale);
    return vars;
}

/** Unique host id per provider instance so `getElementById` targets its own subtree. */
let themeIdSeq = 0;

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
        variant?: DaisyColor;
    }
}

/**
 * Theme class applied to the provider's host view. The six color themes
 * get autocomplete; arbitrary strings are accepted for custom themes or
 * multi-class compositions like `'daisy-light daisy-rounded'`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type DaisyTheme =
    | 'daisy-light'
    | 'daisy-dark'
    | 'daisy-cupcake'
    | 'daisy-emerald'
    | 'daisy-synthwave'
    | 'daisy-dracula'
    | (string & {});

export interface ThemeController {
    /** Current theme class. Reactive — read inside render/effect to track. */
    readonly name: DaisyTheme;
    /**
     * Whether the theme is currently being driven by the system color
     * scheme (true when no `initial` was passed and `set()` hasn't been
     * called since mount). UI like a settings screen can read this to show
     * a "Follow system" indicator.
     */
    readonly followingSystem: boolean;
    /**
     * Replace the active theme. Pins the choice — subsequent system
     * appearance changes won't override it (until `followSystem()` is called).
     */
    set(name: DaisyTheme): void;
    /**
     * Flip to the paired theme — for built-ins, light ↔ dark; for custom
     * themes, follows the `pair` declared in `registerTheme()`, or the
     * first theme of the opposite variant.
     */
    toggle(): void;
    /**
     * Resume following system appearance. Equivalent to mounting fresh
     * with no `initial` prop. Useful for a "Reset to system" button.
     */
    followSystem(): void;
    /**
     * Current global text-scale multiplier (`1` = the theme's default ramp).
     * Reactive — read inside render/effect to track. Orthogonal to the theme:
     * `set()` / `toggle()` leave it untouched.
     */
    readonly fontScale: number;
    /**
     * Set the global text-scale multiplier — the `--text-*` ramp is re-emitted
     * at `defaultPx × scale`. Persists across theme switches, so it's the place
     * to wire a user accessibility preference or a backend-driven setting (e.g.
     * `setFontScale(1.25)`). Inherits into nested `<ThemeProvider>` subtrees.
     */
    setFontScale(scale: number): void;
}

/**
 * Access the active daisyui theme controller. Resolves to the nearest
 * `<ThemeProvider>`'s controller (a content sub-scope), or — at the app root
 * and in *headless* code with no provider mounted — the global controller
 * (`themeController`). Never throws: theme control is reachable from anywhere
 * (issue #113). For control that must always target the app/OS theme
 * regardless of scope (e.g. a status-bar sync), import `themeController`.
 */
export const useTheme = defineInjectable<ThemeController>(() => themeController);

/**
 * Nesting-depth marker. The outermost `<ThemeProvider>` sees depth 0 and binds
 * the global singleton (so headless `themeController` mutations render and the
 * OS bars track it); a nested provider sees >= 1 and creates its own local
 * state — a content sub-scope that recolors its subtree without touching the
 * global theme or the system bars.
 */
const useThemeDepth = defineInjectable<number>(() => 0);

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

/**
 * Wraps children in a `<view class={theme}>` so the daisyui CSS variables
 * defined inside the theme class inherit down to every descendant.
 *
 * Layout: defaults to flex-fill long-form so the wrapper doesn't collapse
 * between ancestors that flex (e.g. `<SafeAreaProvider>`) and descendants
 * that need a sized parent (`<SafeAreaView>`). Consumers override via
 * `style`.
 *
 * Theme name is held in an *object* signal (not a primitive) so the
 * literal-union type survives — `signal<T>` widens primitive literals to
 * plain `string` via `Widen<T>`.
 */
export const ThemeProvider = component<ThemeProviderProps>(({ props, slots }) => {
    const systemScheme = useSystemColorScheme();

    // The underlying signal widens to PrimitiveSignal<string> via Widen<T>;
    // cast at read sites to keep the narrow union throughout the component.
    const readScheme = (): ColorScheme => systemScheme.value as ColorScheme;

    // Root vs. nested. The outermost provider (depth 0) binds the global
    // singleton — so headless `themeController` mutations render here and the OS
    // bars (via StatusBarSync) follow this theme. A nested provider gets its own
    // local state: a content sub-scope that overrides its subtree only.
    const depth = useThemeDepth();
    const isRoot = depth === 0;
    defineProvide(useThemeDepth, () => depth + 1);

    // Stable id for the host view so the runtime `setProperty` call (below) can
    // target it. Unique per instance so nested providers theme their own subtree.
    const hostId = `daisy-theme-${++themeIdSeq}`;


    // Nested providers start at scale 1, so they don't re-emit `--text-*` and
    // the root's scaled ramp inherits through (a nested scope can still opt in
    // via its own `fontScale` prop / `setFontScale`).
    const state: ThemeState = isRoot
        ? globalThemeState
        : signal<ThemeState>(
            props.initial
                ? { name: props.initial as DaisyTheme, following: false, fontScale: props.fontScale ?? 1 }
                : {
                    name: readScheme() === 'dark'
                        ? ((props.dark ?? pickThemeFor('dark')) as DaisyTheme)
                        : ((props.light ?? pickThemeFor('light')) as DaisyTheme),
                    following: true,
                    fontScale: props.fontScale ?? 1,
                },
        );

    // Seed the root from props/system. An explicit `initial` pin is author
    // intent and wins. With no `initial`, reflect the current system scheme into
    // the first render — but only while `following`, so a theme a headless
    // caller set before this mounted is respected, not clobbered. The follow
    // effect below keeps it in sync afterwards.
    if (isRoot) {
        if (props.initial) {
            state.name = props.initial as DaisyTheme;
            state.following = false;
        } else if (state.following) {
            state.name = readScheme() === 'dark'
                ? (props.dark ?? pickThemeFor('dark'))
                : (props.light ?? pickThemeFor('light'));
        }
        // Explicit author intent wins; otherwise keep whatever scale a headless
        // caller may have set before this mounted (default 1).
        if (props.fontScale !== undefined) state.fontScale = props.fontScale;
    }

    const controller: ThemeController = isRoot
        ? themeController
        : makeThemeController(state);
    defineProvide(useTheme, () => controller);

    // Wire the daisy color resolver into `@sigx/lynx-icons`'s injectable
    // so any `<Icon variant="primary">` rendered inside this subtree gets
    // the daisy primary hex automatically. Reading `state.name` inside
    // the resolver makes every icon's render re-run when the theme flips.
    const resolver: IconColorResolver = (iconProps) => {
        const variant = (iconProps as { variant?: DaisyColor }).variant;
        if (!variant) return undefined;
        // Every theme's palette lives in the registry; fall back to daisy-light
        // if the active theme isn't registered. SVG fills can't read CSS vars,
        // so the resolved hex/rgb is substituted into the fill at render time.
        const palette = colorsOf(state.name) ?? colorsOf('daisy-light');
        return palette?.[variant];
    };
    defineProvide(useIconColorResolver, () => resolver);

    // Follow the system color scheme while `following`. Reactive: re-runs when
    // `following` flips true (e.g. `controller.followSystem()`, including the
    // headless `themeController`) or when the OS scheme changes, and writes the
    // matching theme. Reading `state.following` and `systemScheme.value` tracks
    // them; the `name` write is `untrack`ed so it can't re-trigger the effect.
    // Created on mount (the native publisher may populate the scheme between
    // setup and mount) and torn down on unmount.
    let follow: { stop: () => void } | undefined;
    let applyVars: { stop: () => void } | undefined;
    onMounted(() => {
        follow = effect(() => {
            const following = state.following;
            const scheme = readScheme();
            if (!following) return;
            const next = scheme === 'dark'
                ? (props.dark ?? pickThemeFor('dark'))
                : (props.light ?? pickThemeFor('light'));
            untrack(() => {
                if (state.name !== next) state.name = next;
            });
        });

        // Built-in themes are themed by their generated CSS class (applied on
        // the host below), which resolves on the very first frame. This
        // `setProperty` path additionally serves runtime-registered themes
        // (`registerTheme`, no shipped CSS class) — applied once they're
        // selected post-mount, where it lands reliably. Reading `state.name`
        // and `state.fontScale` (via buildThemeVars) tracks them, so this
        // re-runs on every theme change and every `setFontScale`.
        applyVars = effect(() => {
            const vars = buildThemeVars(state.name, state.fontScale);
            if (typeof lynx !== 'undefined') {
                lynx.getElementById(hostId)?.setProperty(vars);
            }
        });
    });

    onUnmounted(() => {
        follow?.stop();
        follow = undefined;
        applyVars?.stop();
        applyVars = undefined;
    });

    return () => {
        // Theme COLORS and any radius/size overrides are applied as real,
        // inheritable CSS custom properties via the Lynx `setProperty` runtime
        // API (see the `applyVars` effect above) — Lynx does NOT honor custom
        // properties declared through the inline `style` attribute in this
        // toolchain. The root background/text are painted here from palette
        // literals (real properties, not custom props) so the surface is themed
        // on first paint; descendants resolve `var(--color-*)` once setProperty
        // has run. The `daisy` base class supplies structural token defaults.
        const palette = colorsOf(state.name) ?? colorsOf('daisy-light')!;

        // Built-ins ship a generated CSS class, so `state.name` alone paints on
        // the first frame. A runtime-registered theme has no class — fall back
        // to its variant's built-in class for the first frame; the `setProperty`
        // effect above then swaps in its exact palette post-mount.
        const themeClass = isBuiltInTheme(state.name)
            ? state.name
            : `${pickThemeFor(variantOf(state.name) ?? 'light')} ${state.name}`;

        const style: Record<string, string | number> = {
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: palette['base-100'],
            color: palette['base-content'],
        };
        if (props.style) Object.assign(style, props.style);

        return (
            <view
                id={hostId}
                class={`daisy ${themeClass}${props.class ? ' ' + props.class : ''}`}
                style={style}
            >
                {slots.default?.()}
            </view>
        );
    };
});

// Re-export registry helpers so consumers only need `@sigx/lynx-daisyui`.
export {
    listThemes,
    registerTheme,
    extendTheme,
    pickThemeFor,
    pairOf,
    variantOf,
    colorsOf,
    radiusOf,
    sizesOf,
} from './registry.js';
export type {
    Theme,
    ThemePalette,
    ThemeRadius,
    ThemeSizes,
    ThemeVariant,
} from './registry.js';
