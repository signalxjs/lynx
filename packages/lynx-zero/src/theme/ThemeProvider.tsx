/**
 * `<ThemeProvider>` and `useTheme()` — the theme engine of the zero-contract
 * stack, ported from lynx-zero-legacy and simplified by what the compiled
 * skins changed:
 *
 * Theme VALUES no longer travel through this component at all. A design
 * system compiles every theme to static CSS (`@sigx/zero-kit`'s lynx target:
 * `.zx-root { … }` defaults plus one full-restatement
 * `.zx-root.zx-theme-<name> { … }` block per theme, every value a literal),
 * so selecting a theme is ONE class swap on the host view. The provider owns
 * exactly three things:
 *
 * - **the host classes** — `zx-root` (the token host, the projection of
 *   `:root` onto a platform without one) plus `zx-theme-<name>` for the
 *   active selection;
 * - **the follow effect** — while `followingSystem`, the appearance signal
 *   (`@sigx/lynx-appearance`, seeded natively before first paint) picks the
 *   theme per scheme via the shared zero registry (`pickThemeFor`), so the
 *   first render is already scheme-correct;
 * - **the font scale** — at `fontScale !== 1` the scalable `--text-*` ramp is
 *   re-emitted as scaled literal px inline on the host (inline custom
 *   properties beat the class declaration); `--text-fixed-*` is untouched by
 *   construction. See `./text-ramp.ts`.
 *
 * Theme METADATA (names, scheme, light/dark pairing) comes from
 * `@sigx/zero/theme/registry` — seeded by the design-system package at module
 * load, exactly like the web runtime.
 *
 * Root vs. nested keeps the legacy semantics: the outermost provider binds
 * the global `themeController` (headless mutations render here); a nested
 * provider is a content island with local state that overrides its subtree.
 */
import type { Define } from '@sigx/lynx';
import { component, defineInjectable, defineProvide, effect, signal } from '@sigx/lynx';
import { useSystemColorScheme } from '@sigx/lynx-appearance';
import { pickThemeFor, themeClass, HOST_CLASS } from './registry-bridge.js';
import type { ThemeController, ThemeName, ThemeState } from './theme-state.js';
import { globalThemeState, makeThemeController, normalizeFontScale, themeController } from './theme-state.js';
import { textRampVars } from './text-ramp.js';

type ColorScheme = 'light' | 'dark';

/**
 * The theme handle for this scope — the global controller unless a nested
 * `<ThemeProvider>` overrode the subtree. Callable headlessly: the default
 * factory returns the global singleton.
 */
export const useTheme = defineInjectable<ThemeController>(() => themeController);

/** Depth marker distinguishing the root provider from nested ones. */
const useThemeDepth = defineInjectable<number>(() => 0);

/** The enclosing scope's font scale, inherited by nested providers. */
const useAmbientFontScale = defineInjectable<number>(() => 1);

export type ThemeProviderProps =
    /** Pin the initial theme; ignores system appearance until `followSystem()`. */
    & Define.Prop<'initial', ThemeName, false>
    /** Theme while the system is light. Defaults to the registry's light default. */
    & Define.Prop<'light', ThemeName, false>
    /** Theme while the system is dark. Defaults to the registry's dark default. */
    & Define.Prop<'dark', ThemeName, false>
    /** Initial in-app text-scale multiplier (`1` = the stylesheet ramp). */
    & Define.Prop<'fontScale', number, false>
    /** Extra classes appended after the theme classes on the host view. */
    & Define.Prop<'class', string, false>
    /** Extra inline style on the host view, merged after the defaults. */
    & Define.Prop<'style', Record<string, string | number>, false>
    & Define.Slot<'default'>;

export const ThemeProvider = component<ThemeProviderProps>(({ props, slots }) => {
    const systemScheme = useSystemColorScheme();
    const readScheme = (): ColorScheme => systemScheme.value as ColorScheme;

    // Read through functions so the props stay reactive and a theme
    // registered after setup is still picked up.
    const themeForScheme = (scheme: ColorScheme): ThemeName =>
        (scheme === 'dark' ? props.dark ?? pickThemeFor('dark') : props.light ?? pickThemeFor('light')) ?? '';

    const depth = useThemeDepth();
    const isRoot = depth === 0;
    defineProvide(useThemeDepth, () => depth + 1);

    // A nested provider with no explicit `fontScale` inherits the enclosing
    // scale, so the root's scale flows through content islands.
    const ambientFontScale = useAmbientFontScale();
    const seedScale = normalizeFontScale(props.fontScale, ambientFontScale);

    const state: ThemeState = isRoot
        ? globalThemeState
        : signal<ThemeState>(
            props.initial
                ? { name: props.initial, following: false, fontScale: seedScale }
                : { name: themeForScheme(readScheme()), following: true, fontScale: seedScale },
        );

    // Seed the root from props/system. An explicit `initial` pin is author
    // intent and wins; with no pin, reflect the current scheme only while
    // `following`, so a theme a headless caller set before mount is
    // respected. The follow effect keeps it in sync afterwards.
    if (isRoot) {
        if (props.initial) {
            state.name = props.initial;
            state.following = false;
        } else if (state.following) {
            state.name = themeForScheme(readScheme());
        }
        if (props.fontScale !== undefined) {
            state.fontScale = normalizeFontScale(props.fontScale, state.fontScale);
        }
    }

    const controller = isRoot ? themeController : makeThemeController(state);
    defineProvide(useTheme, () => controller);
    defineProvide(useAmbientFontScale, () => state.fontScale);

    // The follow effect: while following, the OS scheme picks the theme.
    // JS-driven on this stack — the compiled skins carry no
    // prefers-color-scheme twins (the lynx target drops @media by default),
    // and the appearance signal is seeded natively before first paint, so
    // the first render already reads the right scheme.
    effect(() => {
        if (state.following) {
            state.name = themeForScheme(readScheme());
        }
    });

    return () => {
        const classes = [HOST_CLASS];
        if (state.name) classes.push(themeClass(state.name));
        if (props.class) classes.push(props.class);
        // Root providers flex-fill long-form so the wrapper doesn't collapse
        // between flexing ancestors and descendants that need a sized parent;
        // a nested provider is a content island and sizes to its content
        // (flex-fill's flexBasis: 0 computes to height 0 inside scroll-view
        // content). Consumers override via `style`.
        const style: Record<string, string | number> = isRoot
            ? { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minHeight: 0, ...textRampVars(state.fontScale), ...props.style }
            : { ...textRampVars(state.fontScale), ...props.style };
        return (
            <view class={classes.join(' ')} style={style}>
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'ThemeProvider' });
