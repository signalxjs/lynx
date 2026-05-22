/**
 * `<ThemeProvider>` and `useTheme()` — daisyui theme switching for
 * `@sigx/lynx-daisyui`.
 *
 * The package ships two color themes (`daisy-light`, `daisy-dark`) plus
 * style modifier themes (`daisy-rounded`, `daisy-flat`). Each is a CSS
 * class containing scoped `--color-*` / `--radius-*` / `--border-*`
 * variable definitions; descendants of an element with the class
 * inherit those variables (Lynx has `enableCSSInheritance: true` in
 * its layout-pipeline defaults), and the daisyui components are built
 * to read those vars directly.
 *
 * Usage:
 *
 * ```tsx
 * import { ThemeProvider, useTheme } from '@sigx/lynx-daisyui';
 *
 * defineApp(() => () => (
 *     <ThemeProvider initial="daisy-light">
 *         <App />
 *     </ThemeProvider>
 * ));
 *
 * // Anywhere inside:
 * const theme = useTheme();
 * theme.toggle();             // daisy-light ↔ daisy-dark
 * theme.set('daisy-dark');    // explicit
 * theme.name;                 // 'daisy-light' | 'daisy-dark' | custom string
 * ```
 *
 * For multi-class compositions (color + modifier), set a custom string:
 * `theme.set('daisy-light daisy-rounded')`.
 */
import {
    component,
    defineInjectable,
    defineProvide,
    signal,
    type Define,
} from '@sigx/lynx';
import { useIconVariantResolver, type IconVariantResolver } from '@sigx/lynx-icons';
import type { DaisyColor } from '../shared/styles.js';

/**
 * Declaration-merge extension: every daisy color token becomes a valid
 * `<Icon variant=…>` key at the type level. `@sigx/lynx-icons` ships an
 * empty `IconVariants` interface; this block adds daisy's tokens as
 * keys, making `import type { IconVariant }` resolve to the union.
 *
 * The merge fires whenever this file's types are reachable — i.e. the
 * moment any consumer imports anything from `@sigx/lynx-daisyui`. No
 * subpath, no extra import needed by the consumer.
 */
declare module '@sigx/lynx-icons' {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IconVariants extends Record<DaisyColor, true> {}
}

/**
 * JS-side mirror of the daisy theme color tokens. Required because Lynx's
 * `<svg content=…>` parses the inline SVG markup as a standalone fragment
 * that doesn't evaluate CSS custom properties in attribute values — so a
 * substitution like `fill="var(--color-primary)"` doesn't render the
 * primary color, it falls back to the default fill. We have to inject the
 * resolved hex value at JS time.
 *
 * Keep this in sync with `src/styles/themes/light.css` and
 * `src/styles/themes/dark.css`. The two are the single source of truth;
 * this map is the runtime mirror.
 */
const DAISY_PALETTE = {
    'daisy-light': {
        'primary': '#491dff',
        'primary-content': '#d3dbff',
        'secondary': '#ff20cc',
        'secondary-content': '#fff8fc',
        'accent': '#00cfbd',
        'accent-content': '#00100d',
        'neutral': '#2b3440',
        'neutral-content': '#d7dde4',
        'base-100': '#ffffff',
        'base-200': '#f2f2f2',
        'base-300': '#e5e6e6',
        'base-content': '#1f2937',
        'info': '#00b4fa',
        'info-content': '#000000',
        'success': '#00a96e',
        'success-content': '#000000',
        'warning': '#ffc100',
        'warning-content': '#000000',
        'error': '#ff676a',
        'error-content': '#000000',
    },
    'daisy-dark': {
        'primary': '#7582ff',
        'primary-content': '#050617',
        'secondary': '#ff71cf',
        'secondary-content': '#190211',
        'accent': '#00e7d0',
        'accent-content': '#001210',
        'neutral': '#2a323c',
        'neutral-content': '#a6adbb',
        'base-100': '#1d232a',
        'base-200': '#191e24',
        'base-300': '#343b46',
        'base-content': '#a6adbb',
        'info': '#00b4fa',
        'info-content': '#000000',
        'success': '#00a96e',
        'success-content': '#000000',
        'warning': '#ffc100',
        'warning-content': '#000000',
        'error': '#ff676a',
        'error-content': '#000000',
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
 * Theme class applied to the provider's host view. The two built-ins
 * (`daisy-light` / `daisy-dark`) get autocomplete; arbitrary strings
 * are accepted for custom themes or multi-class compositions like
 * `'daisy-light daisy-rounded'`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type DaisyTheme = 'daisy-light' | 'daisy-dark' | (string & {});

export interface ThemeController {
    /** Current theme class. Reactive — read inside render/effect to track. */
    readonly name: DaisyTheme;
    /** Replace the active theme. */
    set(name: DaisyTheme): void;
    /**
     * Flip between `daisy-light` and `daisy-dark`. When the active
     * theme is neither (custom / multi-class), defaults to
     * `daisy-dark` on first call.
     */
    toggle(): void;
}

/**
 * Access the enclosing daisyui theme controller. Throws when used
 * outside `<ThemeProvider>` — install a provider at your app root.
 */
export const useTheme = defineInjectable<ThemeController>(() => {
    throw new Error(
        '[lynx-daisyui] useTheme() called outside <ThemeProvider>. Wrap your app root with `<ThemeProvider initial="daisy-light">…</ThemeProvider>`.',
    );
});

export type ThemeProviderProps =
    /** Initial theme class. Defaults to `daisy-light`. */
    & Define.Prop<'initial', DaisyTheme, false>
    /** Extra classes appended to the theme class on the host view. */
    & Define.Prop<'class', string, false>
    /** Extra inline style on the host view. Merged after the base flex-fill defaults. */
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Slot<'default'>;

/**
 * Wraps children in a `<view class={theme}>` so the daisyui CSS
 * variables defined inside `.daisy-light` / `.daisy-dark` inherit
 * down to every descendant.
 *
 * The host view defaults to flex-fill long-form so the wrapper doesn't
 * collapse between ancestors that flex (e.g. `<SafeAreaProvider>`) and
 * descendants that need a sized parent (`<SafeAreaView>`). Consumers
 * override the layout via `style`.
 *
 * Theme name is held in an *object* signal (not a primitive) so the
 * literal-union type survives — `signal<T>` widens primitive literals
 * to plain `string` via `Widen<T>`.
 */
export const ThemeProvider = component<ThemeProviderProps>(({ props, slots }) => {
    const state = signal<{ name: DaisyTheme }>({ name: props.initial ?? 'daisy-light' });

    const controller: ThemeController = {
        get name() { return state.name; },
        set(next) { state.name = next; },
        toggle() {
            if (state.name === 'daisy-light') state.name = 'daisy-dark';
            else if (state.name === 'daisy-dark') state.name = 'daisy-light';
            else state.name = 'daisy-dark';
        },
    };

    defineProvide(useTheme, () => controller);

    // Wire the daisy variant resolver into `@sigx/lynx-icons`'s injectable
    // so any `<Icon variant="primary">` rendered inside this subtree gets
    // the daisy primary hex automatically. The resolver reads
    // `state.name` reactively — flipping themes (`theme.toggle()`) makes
    // every icon's render re-run with new colors, no remount.
    const resolver: IconVariantResolver = (v) => {
        const palette = DAISY_PALETTE[paletteFor(state.name)];
        return (palette as Record<string, string>)[v];
    };
    defineProvide(useIconVariantResolver, () => resolver);

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
