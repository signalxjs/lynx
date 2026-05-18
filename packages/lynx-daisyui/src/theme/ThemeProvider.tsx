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
