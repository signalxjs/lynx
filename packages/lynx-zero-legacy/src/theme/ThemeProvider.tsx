/**
 * `<ThemeProvider>` and `useTheme()` — the design-system-neutral theme engine.
 *
 * Themes are palettes of CSS custom properties (`--color-*` / `--radius-*` /
 * `--size-*` / `--text-*`) that inherit to descendants, so design-system
 * components read them directly via `var(--color-*)`. They reach the host view
 * two ways, and which one a theme takes is the whole design here:
 *
 * - **From a stylesheet**, for a theme the design system generated CSS for
 *   (`staticCss`). The host wears the theme name as a class and the engine
 *   resolves `.daisy-dark { … }` — plus, while following the OS, the
 *   `@media (prefers-color-scheme: …)` twin, which means the painted scheme is
 *   the engine's own answer rather than this thread's (#985). Nothing about
 *   the palette rides in a style op.
 * - **Inline**, for everything else: a tenant palette fetched at runtime, an
 *   `extendTheme()` derivative, the web target, or a build with the
 *   `enableCSSRule` kill switch off. `@sigx/lynx-plugin` encodes
 *   `enableCSSInlineVariables` so the native engine (Lynx ≥ 3.6) registers
 *   inline declarations from the very first paint (#116), and these themes
 *   paint their exact palette on frame one like any built-in.
 *
 * Theme *data* comes from the design-system package either way: it seeds the
 * registry at module load (`registerTheme()` in `./registry.ts`), and the
 * generated CSS is emitted from that same data at build time. `followSystem`
 * and `toggle()` treat every registered theme alike.
 *
 * Usage (here with `@sigx/lynx-daisyui`'s themes):
 *
 * ```tsx
 * import { ThemeProvider, useTheme } from '@sigx/lynx-daisyui';
 *
 * // System-aware (default): picks the first registered light/dark theme from
 * // the OS scheme, live-flips when the user toggles dark mode.
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
import { useSystemColorScheme } from '@sigx/lynx-appearance';
import type { ColorScheme } from '@sigx/lynx-appearance';
// CSS-free subpath: just the resolver DI key + type — importing the icons
// barrel here would drag Icon's font-face/svg/codepoint assets into zero's barrel.
import { useIconColorResolver, type IconColorResolver } from '@sigx/lynx-icons/context';
import type { ColorToken } from '../contract.js';
import {
    colorsOf,
    fallbackPalette,
    hasStaticCss,
    pickThemeFor,
    radiusOf,
    sizesOf,
    variantOf,
} from './registry.js';
import type { ThemeVariant } from './registry.js';
import { themeCustomProperties, textRampVars } from './theme-tokens.js';
import {
    globalThemeState,
    makeThemeController,
    normalizeFontScale,
    themeController,
    type ThemeState,
} from './theme-state.js';

/**
 * Declaration-merge a typed `variant` prop onto `<Icon>` (and the pinned
 * adapters). `@sigx/lynx-icons` has no notion of variants; the foundation owns
 * the concept so every design system inherits it. The merge fires the moment
 * any consumer imports anything from `@sigx/lynx-zero-legacy` (or a DS that re-exports
 * it). `<ThemeProvider>` provides the resolver that turns the variant into the
 * active theme's hex (below).
 */
declare module '@sigx/lynx-icons' {
    interface IconPropsExtensions {
        /** Semantic color token applied as the icon's `fill`, resolved to the
         *  active theme's hex via `useIconColorResolver`. */
        variant?: ColorToken;
    }
}

/**
 * Whether stylesheet at-rules reach this bundle's binary — folded to a literal
 * by `@sigx/lynx-plugin` (false on web, and whenever the `enableCSSRule` kill
 * switch is off). It decides whether a `staticCss` theme's generated
 * `@media (prefers-color-scheme: …)` rules exist to resolve against; when they
 * don't, every theme takes the inline path below.
 *
 * Read through `typeof` with a `globalThis` fallback (the `platform.ts`
 * pattern) so a non-plugin embed or a Vitest run — where the define is absent —
 * lands on the inline path rather than a `ReferenceError`.
 */
declare const __SIGX_CSS_RULE__: boolean | undefined;

const cssRulesEncode = (): boolean =>
    typeof __SIGX_CSS_RULE__ !== 'undefined'
        ? __SIGX_CSS_RULE__
        : (globalThis as { __SIGX_CSS_RULE__?: boolean }).__SIGX_CSS_RULE__ === true;

/**
 * Whether the CSS engine can select `name` for `scheme` on its own — i.e. the
 * design system generated a `.lynx-zero.scheme-<scheme>-<name>` rule inside a
 * `@media (prefers-color-scheme: …)` block for it.
 *
 * Requires a single-token name (a multi-class composition like
 * `'daisy-light daisy-rounded'` can't be spliced into a class name), a shipped
 * stylesheet, and a variant that matches the scheme the rule answers for — an
 * app is free to pass `dark="some-light-theme"`, and there is no rule for that.
 */
const engineSelectable = (name: ThemeName, scheme: ThemeVariant): boolean =>
    !/\s/.test(name) && hasStaticCss(name) && variantOf(name) === scheme;

/**
 * The theme's custom properties for the *inline* path — colors, any
 * radius/size overrides, and the `fontScale`-adjusted text ramp.
 *
 * This is what a theme with no generated stylesheet rule gets: with
 * `enableCSSInlineVariables` in the template's page config (encoded by
 * `@sigx/lynx-plugin`), inline custom properties register and inherit from
 * first paint on native Lynx ≥ 3.6, and a value change re-resolves every
 * descendant `var()` on native Lynx ≥ 3.9 — the CLI's host templates pin
 * 4.0.1; older hosts paint frame one but won't follow theme switches (#116).
 *
 * A `staticCss` theme skips the palette half of this entirely (the CSS engine
 * resolves it from `.theme-name`); the text ramp is never in CSS because
 * `fontScale` is runtime state.
 */
function buildThemeVars(
    name: string,
    fontScale: number,
    withPalette: boolean,
): Record<string, string> {
    const vars: Record<string, string> = withPalette
        ? themeCustomProperties({
            colors: colorsOf(name) ?? fallbackPalette(),
            radius: radiusOf(name),
            sizes: sizesOf(name),
        })
        : {};
    // At scale 1 the `.lynx-zero` class already declares exactly this ramp, and
    // a class declaration on the element beats anything inherited from an
    // enclosing scaled provider — so emitting it would only restate the
    // defaults.
    if (fontScale !== 1) Object.assign(vars, textRampVars(fontScale));
    return vars;
}

/**
 * Theme class applied to the provider's host view. Plain string — a design
 * system layers a literal union on top for autocomplete (e.g. daisyui's
 * `DaisyTheme`). Multi-class compositions like `'daisy-light daisy-rounded'`
 * are accepted.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types
export type ThemeName = string & {};

export interface ThemeController {
    /** Current theme class. Reactive — read inside render/effect to track. */
    readonly name: ThemeName;
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
    set(name: ThemeName): void;
    /**
     * Flip to the paired theme — light ↔ dark by default; follows the `pair`
     * declared in `registerTheme()`, or the first theme of the opposite
     * variant.
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
 * Access the active theme controller. Resolves to the nearest
 * `<ThemeProvider>`'s controller (a content sub-scope), or — at the app root
 * and in *headless* code with no provider mounted — the global controller
 * (`themeController`). Never throws: theme control is reachable from anywhere.
 * For control that must always target the app/OS theme regardless of scope
 * (e.g. a status-bar sync), import `themeController`.
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

/**
 * Ambient text scale inherited by nested providers. A nested `<ThemeProvider>`
 * with no explicit `fontScale` prop seeds from this (the enclosing scale,
 * default 1) instead of resetting to 1 — so the root's scale flows down through
 * color sub-scopes. Each provider re-provides its own current scale.
 */
const useAmbientFontScale = defineInjectable<number>(() => 1);

export type ThemeProviderProps =
    /**
     * Pin the initial theme. When set, the provider ignores system
     * appearance until `controller.followSystem()` is called. When
     * omitted, the provider follows the OS color scheme and live-flips
     * with it.
     */
    & Define.Prop<'initial', ThemeName, false>
    /**
     * Theme to use when the system color scheme is `'light'`. Defaults to
     * the first registered light theme. Only consulted while
     * `followingSystem` is true.
     */
    & Define.Prop<'light', ThemeName, false>
    /**
     * Theme to use when the system color scheme is `'dark'`. Defaults to
     * the first registered dark theme. Only consulted while
     * `followingSystem` is true.
     */
    & Define.Prop<'dark', ThemeName, false>
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
    /**
     * Override the icon-color resolver this scope provides. By default the
     * provider resolves an `<Icon variant>` to the active theme's palette hex
     * — design-system-agnostic, works for any registered theme. Supply this to
     * customize the mapping (e.g. a DS-specific token aliasing).
     */
    & Define.Prop<'iconColorResolver', IconColorResolver, false>
    & Define.Slot<'default'>;

/**
 * Wraps children in a `<view class={theme}>` that carries the theme's full
 * custom-property set — from the generated stylesheet rule when the theme
 * ships one, inline otherwise — so the variables inherit down to every
 * descendant from first paint. The theme name is on the host either way, both
 * as the palette selector and for shape/behavior modifiers (e.g.
 * `daisy-rounded`); while following the OS with a CSS-backed pair, two
 * `scheme-light-…` / `scheme-dark-…` classes ride along so the engine picks
 * between them.
 *
 * Layout: the root provider defaults to flex-fill long-form so the wrapper
 * doesn't collapse between ancestors that flex (e.g. `<SafeAreaProvider>`)
 * and descendants that need a sized parent (`<SafeAreaView>`). A nested
 * provider is a content island and sizes to its content instead — flex-fill's
 * `flexBasis: 0` computes to height 0 inside scroll-view content, where
 * nothing grows it back (#269). Consumers override via `style`.
 *
 * Theme name is held in an *object* signal (not a primitive) so literal-union
 * types a DS layers on survive — `signal<T>` widens primitive literals to
 * plain `string` via `Widen<T>`.
 */
export const ThemeProvider = component<ThemeProviderProps>(({ props, slots }) => {
    const systemScheme = useSystemColorScheme();

    // The underlying signal widens to PrimitiveSignal<string> via Widen<T>;
    // cast at read sites to keep the narrow union throughout the component.
    const readScheme = (): ColorScheme => systemScheme.value as ColorScheme;

    // The light/dark pair this scope follows: the `light`/`dark` props when
    // given, else the first registered theme of each variant. Read through
    // functions (not captured once) so the props stay reactive and a theme
    // registered after setup is still picked up.
    const lightTheme = (): ThemeName => props.light ?? pickThemeFor('light');
    const darkTheme = (): ThemeName => props.dark ?? pickThemeFor('dark');
    const themeForScheme = (scheme: ColorScheme): ThemeName =>
        scheme === 'dark' ? darkTheme() : lightTheme();

    // Root vs. nested. The outermost provider (depth 0) binds the global
    // singleton — so headless `themeController` mutations render here and the OS
    // bars (via StatusBarSync) follow this theme. A nested provider gets its own
    // local state: a content sub-scope that overrides its subtree only.
    const depth = useThemeDepth();
    const isRoot = depth === 0;
    defineProvide(useThemeDepth, () => depth + 1);

    // A nested provider with no explicit `fontScale` inherits the enclosing
    // scale (default 1 at the root), so the root's scale flows down through
    // color sub-scopes rather than resetting. An explicit prop overrides it.
    const ambientFontScale = useAmbientFontScale();
    const seedScale = normalizeFontScale(props.fontScale, ambientFontScale);

    const state: ThemeState = isRoot
        ? globalThemeState
        : signal<ThemeState>(
            props.initial
                ? { name: props.initial, following: false, fontScale: seedScale }
                : {
                    name: themeForScheme(readScheme()),
                    following: true,
                    fontScale: seedScale,
                },
        );

    // Seed the root from props/system. An explicit `initial` pin is author
    // intent and wins. With no `initial`, reflect the current system scheme into
    // the first render — but only while `following`, so a theme a headless
    // caller set before this mounted is respected, not clobbered. The follow
    // effect below keeps it in sync afterwards.
    if (isRoot) {
        if (props.initial) {
            state.name = props.initial;
            state.following = false;
        } else if (state.following) {
            state.name = themeForScheme(readScheme());
        }
        // Explicit author intent wins; otherwise keep whatever scale a headless
        // caller may have set before this mounted (default 1).
        if (props.fontScale !== undefined) {
            state.fontScale = normalizeFontScale(props.fontScale, state.fontScale);
        }
    }

    const controller: ThemeController = isRoot
        ? themeController
        : makeThemeController(state);
    defineProvide(useTheme, () => controller);
    // Re-provide this scope's current scale so nested providers inherit it.
    defineProvide(useAmbientFontScale, () => state.fontScale);

    // Icon-color resolver for this scope: map `<Icon variant>` to the active
    // theme's palette hex (SVG fills can't read CSS vars, so the hex is
    // substituted into `fill=` at render). Design-system-agnostic — reads the
    // registered palette for whatever theme this scope shows, so daisy and hero
    // icons both theme correctly, per sub-scope. A consumer can override via the
    // `iconColorResolver` prop. Reading `state.name` re-runs icons on theme flip.
    const defaultIconResolver: IconColorResolver = (iconProps) => {
        const variant = (iconProps as { variant?: ColorToken }).variant;
        if (!variant) return undefined;
        const palette = colorsOf(state.name) ?? fallbackPalette();
        return palette?.[variant];
    };
    defineProvide(useIconColorResolver, () => props.iconColorResolver ?? defaultIconResolver);

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
            const next = themeForScheme(scheme);
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
        // Does this theme's palette ship as a stylesheet rule the engine can
        // resolve? If so the host wears the theme name and the CSS does the
        // rest — no palette in the style op at all. Otherwise (any
        // runtime-registered theme, web, `enableCSSRule: false`) the full
        // palette is declared inline: correct on first paint and re-resolved
        // on every descendant when a theme switch re-renders this closure.
        const cssPalette = cssRulesEncode() && hasStaticCss(state.name);

        // While following the OS, hand the scheme decision to the engine as
        // well: both candidate themes carry a `@media (prefers-color-scheme)`
        // rule, so adding both classes lets exactly one win — natively, and
        // even if this thread's idea of the scheme is stale (#990). The rules
        // are compound (`.lynx-zero.scheme-…`), so they outrank the pinned
        // `.<name>` rule that the theme-name class also matches.
        const light = lightTheme();
        const dark = darkTheme();
        const engineFollows = cssPalette
            && state.following
            && engineSelectable(light, 'light')
            && engineSelectable(dark, 'dark');

        // Root: flex-fill long-form (see the component doc comment). Nested:
        // content-sized — a sub-scope inside scroll content would otherwise
        // collapse to zero height via `flexBasis: 0` (#269).
        const style: Record<string, string | number> = isRoot
            ? {
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
            }
            : {
                display: 'flex',
                flexDirection: 'column',
            };
        Object.assign(style, buildThemeVars(state.name, state.fontScale, !cssPalette));
        const palette = colorsOf(state.name) ?? fallbackPalette();
        if (palette && !cssPalette) {
            // Painted as literal properties (not `var()` self-references) so
            // the provider's own surface never depends on same-element
            // custom-property resolution. The generated rules carry the same
            // two declarations, which is why the CSS path skips them here.
            style.backgroundColor = palette['base-100'];
            style.color = palette['base-content'];
        }
        if (props.style) Object.assign(style, props.style);

        const schemeClasses = engineFollows
            ? ` scheme-light-${light} scheme-dark-${dark}`
            : '';

        return (
            <view
                class={`lynx-zero ${state.name}${schemeClasses}${props.class ? ' ' + props.class : ''}`}
                style={style}
            >
                {slots.default?.()}
            </view>
        );
    };
});

// Re-export registry helpers so consumers only need one import source.
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
