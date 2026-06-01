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
import type { DaisyTheme, ThemeController } from './ThemeProvider.js';

/** The mutable selection a `ThemeController` reads from and writes to. */
export interface ThemeState {
    name: DaisyTheme;
    following: boolean;
    /**
     * Global text-scale multiplier applied on top of the theme's `--text-*`
     * ramp. Orthogonal to `name`: a theme switch / `toggle()` leaves it
     * untouched, so a user/accessibility scale persists across appearance
     * changes. `1` = the default ramp.
     */
    fontScale: number;
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
            state.fontScale = scale;
        },
    };
}

// Object signal (not primitive) so the `DaisyTheme` literal union survives —
// `signal<T>` widens primitive literals to plain `string` via `Widen<T>`.
// Seeded to a sane default; the root <ThemeProvider> re-seeds from the system
// color scheme + its props on mount.
const state = signal<ThemeState>({
    name: pickThemeFor('light') as DaisyTheme,
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
 * The global theme controller — the headless handle for issue #113. Import and
 * call from anywhere (no `<ThemeProvider>` ancestor required); `useTheme()`'s
 * default factory returns this same instance, and the root `<ThemeProvider>`
 * provides it to its subtree. `StatusBarSync` binds to it so the OS bars always
 * follow the global/screen theme, never a content sub-scope.
 */
export const themeController: ThemeController = makeThemeController(state);
