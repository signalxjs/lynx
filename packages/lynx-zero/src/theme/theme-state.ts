/**
 * Global theme state — the headless DI singleton behind `useTheme()`, ported
 * from lynx-zero-legacy onto the zero contract: theme METADATA (names,
 * scheme, pairing) now comes from `@sigx/zero/theme/registry` — the same
 * registry the web runtime uses, seeded by a design system's compiled
 * manifest — and theme VALUES live in the skin's compiled `.zx-theme-<name>`
 * CSS, so selection here is which class the provider renders, nothing more.
 *
 * The active selection (current theme name + follow-system flag + in-app
 * font scale) lives in a module-level signal so theme control is reachable
 * from headless code — a store, app-boot logic, an effect — not just from a
 * component under `<ThemeProvider>`.
 */
import { signal } from '@sigx/lynx';
import { pairOf, pickThemeFor } from '@sigx/zero/theme/registry';

export type ThemeName = string;

/** The handle `useTheme()` returns — identical shape to the legacy one. */
export interface ThemeController {
    readonly name: ThemeName;
    readonly followingSystem: boolean;
    /**
     * In-app text-scale multiplier over the theme's `--text-*` ramp. The OS
     * text-size setting is separate (the native host feeds it into the
     * engine, which scales every font-size); the two compose
     * multiplicatively — never seed this from `useFontScale()`.
     * `--text-fixed-*` is exactly the ramp this multiplier never touches.
     */
    readonly fontScale: number;
    set(next: ThemeName): void;
    toggle(): void;
    followSystem(): void;
    setFontScale(scale: number): void;
}

/** The mutable selection a `ThemeController` reads from and writes to. */
export interface ThemeState {
    name: ThemeName;
    following: boolean;
    fontScale: number;
}

/**
 * Coerce a font-scale input to a valid positive, finite multiplier. Rejects
 * `NaN`, `±Infinity`, and non-positive values — which would otherwise emit
 * invalid CSS (`NaNpx`, negative font sizes) — by returning `fallback`.
 */
export function normalizeFontScale(value: unknown, fallback = 1): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}

/**
 * Build a `ThemeController` over a given state object — the global singleton
 * below, or a nested `<ThemeProvider>`'s local state. `followSystem()` only
 * flips the flag; the owning provider's follow effect performs the re-apply
 * (it has the appearance signal in scope).
 */
export function makeThemeController(state: ThemeState): ThemeController {
    return {
        get name() {
            return state.name;
        },
        get followingSystem() {
            return state.following;
        },
        get fontScale() {
            return state.fontScale;
        },
        set(next) {
            state.name = next;
            state.following = false;
        },
        toggle() {
            // zero's registry answers `undefined` for an unpaired theme —
            // toggling one is a no-op rather than a jump to ''.
            state.name = pairOf(state.name) ?? state.name;
            state.following = false;
        },
        followSystem() {
            state.following = true;
        },
        setFontScale(scale) {
            state.fontScale = normalizeFontScale(scale, state.fontScale);
        },
    };
}

// Object signal (not primitive) so theme-name literal unions a DS layers on
// top survive widening. Seeded from whatever is registered at first import
// (a DS package seeds the registry at its own module load; until then the
// name is '') — the root <ThemeProvider> re-seeds from the system color
// scheme + its props on mount.
const state = signal<ThemeState>({
    name: pickThemeFor('light') ?? '',
    following: true,
    fontScale: 1,
});

/** @internal — the backing signal the root `<ThemeProvider>` binds to. */
export const globalThemeState = state;

/**
 * The global theme controller — the headless handle. Import and call from
 * anywhere; `useTheme()`'s default factory returns this same instance.
 */
export const themeController: ThemeController = makeThemeController(state);
