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
    onMounted,
    onUnmounted,
    signal,
    type Define,
} from '@sigx/lynx';
import { useIconColorResolver, type IconColorResolver } from '@sigx/lynx-icons';
import { useSystemColorScheme } from '@sigx/lynx-appearance';
import type { ColorScheme } from '@sigx/lynx-appearance';
import type { DaisyColor } from '../shared/styles.js';
import { colorsOf, pairOf, pickThemeFor, radiusOf, variantOf } from './registry.js';

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
 * Access the enclosing daisyui theme controller. Throws when used
 * outside `<ThemeProvider>` — install a provider at your app root.
 */
export const useTheme = defineInjectable<ThemeController>(() => {
    throw new Error(
        '[lynx-daisyui] useTheme() called outside <ThemeProvider>. Wrap your app root with `<ThemeProvider>…</ThemeProvider>`.',
    );
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

    // Seed: pin to `initial` if set, otherwise follow system.
    const initialState = props.initial
        ? { name: props.initial as DaisyTheme, following: false }
        : {
            name: readScheme() === 'dark'
                ? ((props.dark ?? pickThemeFor('dark')) as DaisyTheme)
                : ((props.light ?? pickThemeFor('light')) as DaisyTheme),
            following: true,
        };
    const state = signal<{ name: DaisyTheme; following: boolean }>(initialState);

    // Guard against re-applying the same theme on stray re-fires.
    let lastApplied: ColorScheme | null = state.following ? readScheme() : null;

    function applySystem(scheme: ColorScheme, force = false): void {
        if (!state.following) return;
        if (!force && lastApplied === scheme) return;
        lastApplied = scheme;
        state.name = scheme === 'dark'
            ? (props.dark ?? pickThemeFor('dark'))
            : (props.light ?? pickThemeFor('light'));
    }

    const controller: ThemeController = {
        get name() { return state.name; },
        get followingSystem() { return state.following; },
        set(next) {
            state.name = next;
            state.following = false;
        },
        toggle() {
            state.name = pairOf(state.name);
            state.following = false;
        },
        followSystem() {
            state.following = true;
            applySystem(readScheme(), /* force */ true);
        },
    };

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

    // Subscribe to system color-scheme changes. Both PrimitiveSignal and
    // Computed expose `.subscribe(fn)` returning an unsubscribe handle —
    // we lean on the structural shape so this file doesn't pull
    // @sigx/reactivity into its imports.
    let unsubscribe: (() => void) | undefined;
    onMounted(() => {
        // Re-seed once mounted — covers the case where the native publisher
        // populated `__globalProps` between setup and mount.
        applySystem(readScheme());

        const sig = systemScheme as unknown as {
            subscribe?: (fn: () => void) => () => void;
        };
        if (typeof sig.subscribe === 'function') {
            unsubscribe = sig.subscribe(() => applySystem(readScheme()));
        }
    });

    onUnmounted(() => {
        unsubscribe?.();
        unsubscribe = undefined;
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
