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
import { colorsOf, pickThemeFor, radiusOf } from './registry.js';
import {
    globalThemeState,
    makeThemeController,
    themeController,
    type ThemeState,
} from './theme-state.js';

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

    const state: ThemeState = isRoot
        ? globalThemeState
        : signal<ThemeState>(
            props.initial
                ? { name: props.initial as DaisyTheme, following: false }
                : {
                    name: readScheme() === 'dark'
                        ? ((props.dark ?? pickThemeFor('dark')) as DaisyTheme)
                        : ((props.light ?? pickThemeFor('light')) as DaisyTheme),
                    following: true,
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
    });

    onUnmounted(() => {
        follow?.stop();
        follow = undefined;
    });

    return () => {
        // Every theme is data. Apply its color tokens as inline CSS custom
        // properties — Lynx inherits custom properties to descendants, so
        // component classes resolve `var(--color-*)` against these (the same
        // mechanism SafeAreaProvider uses for `--sat`/`--sal`). The `daisy`
        // base class supplies theme-agnostic structural tokens (radius,
        // sizing); a theme may override roundness via `radius`. The root
        // background/text are painted from the palette literals (inline
        // `var()` values don't resolve in Lynx).
        const palette = colorsOf(state.name) ?? colorsOf('daisy-light')!;
        const radius = radiusOf(state.name);

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
        for (const key in palette) {
            style[`--color-${key}`] = palette[key as DaisyColor];
        }
        if (radius) {
            if (radius.box) style['--rounded-box'] = radius.box;
            if (radius.btn) style['--rounded-btn'] = radius.btn;
            if (radius.badge) style['--rounded-badge'] = radius.badge;
            if (radius.tab) style['--rounded-tab'] = radius.tab;
            if (radius.selector) style['--rounded-selector'] = radius.selector;
            if (radius.toggle) style['--rounded-toggle'] = radius.toggle;
        }
        if (props.style) Object.assign(style, props.style);

        return (
            <view
                class={`daisy${props.class ? ' ' + props.class : ''}`}
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
} from './registry.js';
export type { Theme, ThemePalette, ThemeRadius, ThemeVariant } from './registry.js';
