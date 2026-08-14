/**
 * `useScreenTheme(name)` — pin the **global** theme while a navigation
 * screen is focused, restoring the previous selection when it blurs.
 *
 * This is the right tool for *per-screen* theming — "this screen is dark, that
 * one is light." Because it drives the global theme (not a content sub-scope),
 * the OS status/navigation bars follow automatically via `<StatusBarSync>`, so
 * the bar icons stay legible against each screen's background. For recoloring a
 * *region within* a screen without touching the bars, nest a `<ThemeProvider>`
 * instead.
 *
 * Built on `useFocusEffect` from `@sigx/lynx-navigation` (an optional peer
 * dependency): it must be called from inside a component rendered as a route by
 * `<Stack>` / `<Tabs>` — the same constraint as `useFocusEffect`/`useIsFocused`.
 *
 * Save/restore composes with the stack (LIFO focus/blur): pushing a themed
 * screen saves whatever was live, applies its own theme, and restores on pop —
 * including resuming follow-system if that's what was active.
 *
 * ```tsx
 * const Gallery = component(() => {
 *     useScreenTheme('daisy-dark'); // dark while this screen is on top
 *     return () => <view>…</view>;
 * });
 * ```
 */
import { useFocusEffect } from '@sigx/lynx-navigation';
import { themeController } from './theme-state.js';
import type { ThemeName } from './ThemeProvider.js';

/** Pin the global theme to `name` while this screen is focused; restore on blur. */
export function useScreenTheme(name: ThemeName): void {
    useFocusEffect(() => {
        const prevName = themeController.name;
        const prevFollowing = themeController.followingSystem;
        themeController.set(name);
        return () => {
            if (prevFollowing) themeController.followSystem();
            else themeController.set(prevName);
        };
    });
}
