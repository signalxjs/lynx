import {
    component,
    defineInjectable,
    defineProvide,
    signal,
    type Define,
} from '@sigx/lynx';

export type ThemeName = 'daisy-light' | 'daisy-dark';

export interface ThemeController {
    /** Current theme name. Reactive — read inside render/effect to track. */
    readonly name: ThemeName;
    set(name: ThemeName): void;
    toggle(): void;
}

/**
 * Access the enclosing theme. Throws when used outside <ThemeProvider>.
 */
export const useTheme = defineInjectable<ThemeController>(() => {
    throw new Error(
        '[showcase] useTheme() called outside <ThemeProvider>.',
    );
});

type ThemeProviderProps =
    & Define.Prop<'initial', ThemeName, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Slot<'default'>;

/**
 * Wraps children in a `<view class={theme}>` so the daisyui CSS variables
 * (`--color-primary`, etc.) defined inside `.daisy-light` / `.daisy-dark`
 * inherit down to every descendant. Lynx has `enableCSSInheritance: true`
 * set in lynx.config.ts so the variables propagate.
 *
 * Note: theme name is held in an *object* signal (not a primitive) so the
 * literal union `ThemeName` survives — `signal<T>` widens primitive
 * literals to plain `string` via `Widen<T>`.
 */
export const ThemeProvider = component<ThemeProviderProps>(({ props, slots }) => {
    const state = signal<{ name: ThemeName }>({ name: props.initial ?? 'daisy-light' });

    const controller: ThemeController = {
        get name() { return state.name; },
        set(next) { state.name = next; },
        toggle() {
            state.name = state.name === 'daisy-light' ? 'daisy-dark' : 'daisy-light';
        },
    };

    defineProvide(useTheme, () => controller);

    return () => {
        // Default to flex-fill so this wrapper doesn't collapse between
        // ancestors that flex (SafeAreaProvider) and descendants that need
        // a sized parent (SafeAreaView). Consumers override via `style`.
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
