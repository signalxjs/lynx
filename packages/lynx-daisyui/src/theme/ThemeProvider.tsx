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
import { pairOf, pickThemeFor } from './registry.js';

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
 * JS-side mirror of the daisy theme color tokens — v1 scaffolding for
 * SVG-mode rendering, intended to retire when font-mode lands.
 *
 * **Why this duplicates the CSS:** Lynx's `<svg content=…>` parses the
 * inline SVG markup as a standalone fragment (rasterized offscreen, see
 * `@lynx-js/web-elements/XSvg.js` for the web fallback that wraps it in
 * a `Blob`/`<img>`). The fragment doesn't evaluate CSS custom properties
 * in attribute values, so `fill="var(--color-primary)"` falls back to
 * the default fill. So we substitute the resolved hex at JS time.
 *
 * Keep entries in sync with `src/styles/themes/*.css`. CI doesn't enforce
 * alignment yet (drift-detection test deferred — the palette is intended
 * to retire once font-mode lands).
 */
const DAISY_PALETTE = {
    'daisy-light': {
        'primary': '#491dff', 'primary-content': '#d3dbff',
        'secondary': '#ff20cc', 'secondary-content': '#fff8fc',
        'accent': '#00cfbd', 'accent-content': '#00100d',
        'neutral': '#2b3440', 'neutral-content': '#d7dde4',
        'base-100': '#ffffff', 'base-200': '#f2f2f2', 'base-300': '#e5e6e6',
        'base-content': '#1f2937',
        'info': '#00b4fa', 'info-content': '#000000',
        'success': '#00a96e', 'success-content': '#000000',
        'warning': '#ffc100', 'warning-content': '#000000',
        'error': '#ff676a', 'error-content': '#000000',
    },
    'daisy-dark': {
        'primary': '#7582ff', 'primary-content': '#050617',
        'secondary': '#ff71cf', 'secondary-content': '#190211',
        'accent': '#00e7d0', 'accent-content': '#001210',
        'neutral': '#2a323c', 'neutral-content': '#a6adbb',
        'base-100': '#1d232a', 'base-200': '#191e24', 'base-300': '#343b46',
        'base-content': '#a6adbb',
        'info': '#00b4fa', 'info-content': '#000000',
        'success': '#00a96e', 'success-content': '#000000',
        'warning': '#ffc100', 'warning-content': '#000000',
        'error': '#ff676a', 'error-content': '#000000',
    },
    'daisy-cupcake': {
        'primary': '#65c3c8', 'primary-content': '#052124',
        'secondary': '#ef9fbc', 'secondary-content': '#2d0a16',
        'accent': '#eeaf3a', 'accent-content': '#2d1c00',
        'neutral': '#291334', 'neutral-content': '#f5f1f8',
        'base-100': '#faf7f5', 'base-200': '#efeae6', 'base-300': '#e7e2df',
        'base-content': '#291334',
        'info': '#00b4fa', 'info-content': '#000000',
        'success': '#00a96e', 'success-content': '#000000',
        'warning': '#ffc100', 'warning-content': '#000000',
        'error': '#ff676a', 'error-content': '#000000',
    },
    'daisy-emerald': {
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
    'daisy-synthwave': {
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
    'daisy-dracula': {
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
} as const;

type DaisyPaletteName = keyof typeof DAISY_PALETTE;
const DEFAULT_PALETTE: DaisyPaletteName = 'daisy-light';

/** Pick the right palette for a `theme.name` value (may be a space-separated combo like `'daisy-light daisy-rounded'`). */
function paletteFor(themeName: string): DaisyPaletteName {
    for (const part of themeName.split(/\s+/)) {
        if (part in DAISY_PALETTE) return part as DaisyPaletteName;
    }
    return DEFAULT_PALETTE;
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
        const palette = DAISY_PALETTE[paletteFor(state.name)];
        return (palette as Record<string, string>)[variant];
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
        const baseStyle: Record<string, string | number> = {
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
        };
        return (
            <view
                class={`${state.name}${props.class ? ' ' + props.class : ''}`}
                style={props.style ? { ...baseStyle, ...props.style } : baseStyle}
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
    pickThemeFor,
    pairOf,
    variantOf,
} from './registry.js';
export type { ThemeMeta, ThemeVariant } from './registry.js';
