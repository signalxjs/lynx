/**
 * Global theme state — the headless DI singleton behind `useTheme()`.
 *
 * The active selection (current theme name + follow-system flag) lives here as
 * a module-level signal, mirroring how `./registry.ts` is already a global
 * module singleton. This is what makes theme control reachable from *headless*
 * code — a store, a service, app-boot logic, an effect — not just from a
 * component mounted under `<ThemeProvider>`.
 *
 * The root `<ThemeProvider>` (depth 0) binds to this state: it renders its host
 * view from it, owns the system-color-scheme follow effect that writes to it
 * while `following`, and seeds an `initial` prop into it. Nested providers
 * (depth >= 1) build their own local state via `makeThemeController` so a
 * subtree can be overridden without touching the global — see
 * `./ThemeProvider.tsx`.
 *
 * `followSystem()` here only flips the flag; the actual re-apply on an OS color
 * scheme change is driven by the root provider's follow effect (which has the
 * appearance signal in scope).
 */
import { signal } from '@sigx/lynx';
import { pairOf, pickThemeFor } from './registry.js';
import type { ThemeController, ThemeName } from './ThemeProvider.js';

/** The mutable selection a `ThemeController` reads from and writes to. */
export interface ThemeState {
    name: ThemeName;
    following: boolean;
    /**
     * Global text-scale multiplier applied on top of the theme's `--text-*`
     * ramp. Orthogonal to `name`: a theme switch / `toggle()` leaves it
     * untouched, so a user-chosen scale persists across appearance changes.
     * `1` = the default ramp.
     *
     * This is an IN-APP preference (e.g. a "text size" setting inside the
     * app). The OS text-size setting is separate: the native host feeds it
     * into the engine (`LynxViewBuilder.fontScale` / `updateFontScale`, see
     * #766), which scales every `font-size` — including this ramp's literal
     * px — so the two compose multiplicatively. Do NOT seed this from
     * `useFontScale()`; that would apply the OS scale twice.
     */
    fontScale: number;
}

/**
 * Coerce a font-scale input to a valid positive, finite multiplier. Rejects
 * `NaN`, `±Infinity`, and non-positive values — which would otherwise emit
 * invalid CSS (`NaNpx`, negative font sizes) and break `fontScale === 1`
 * comparisons — by returning `fallback` instead.
 */
export function normalizeFontScale(value: unknown, fallback = 1): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}

/**
 * Build a `ThemeController` over a given state object. Used for both the global
 * singleton (below) and each nested `<ThemeProvider>`'s local state — same
 * behaviour, different backing store. `followSystem()` only flips the flag; the
 * owning provider's follow effect performs the re-apply.
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
            state.name = pairOf(state.name);
            state.following = false;
        },
        followSystem() {
            state.following = true;
        },
        setFontScale(scale) {
            // Ignore invalid input (keep the current scale) so state stays valid.
            state.fontScale = normalizeFontScale(scale, state.fontScale);
        },
    };
}

// Object signal (not primitive) so theme-name literal unions a DS layers on
// top survive — `signal<T>` widens primitive literals to plain `string` via
// `Widen<T>`. Seeded from whatever is registered at first import (a DS package
// seeds the registry at its own module load; until then the name is '') —
// the root <ThemeProvider> re-seeds from the system color scheme + its props
// on mount.
const state = signal<ThemeState>({
    name: pickThemeFor('light'),
    following: true,
    fontScale: 1,
});

/**
 * The backing signal for the global theme. Read/written by the root
 * `<ThemeProvider>` and shared with `themeController`; not part of the public
 * API.
 * @internal
 */
export const globalThemeState = state;

/**
 * The global theme controller — the headless handle. Import and call from
 * anywhere (no `<ThemeProvider>` ancestor required); `useTheme()`'s default
 * factory returns this same instance, and the root `<ThemeProvider>` provides
 * it to its subtree. `StatusBarSync` binds to it so the OS bars always follow
 * the global/screen theme, never a content sub-scope.
 */
export const themeController: ThemeController = makeThemeController(state);
