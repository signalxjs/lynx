/**
 * The gallery's page theme (#1193). `?theme=<name>` themes the ZeroRoot
 * subtree, but the strips outside the screen (the status bar and the home
 * indicator) belong to the app shell: its `SafeAreaView` paints the APP
 * theme's `bg-base-100`, and `StatusBarSync` tints the bar icons from the
 * app theme's variant. So a dark gallery shot kept white strips and black
 * status-bar text, and an open dialog's backdrop dimmed them to mid grey.
 *
 * The fix pins the app theme to a mirror of the zero theme while a gallery
 * screen is focused (`useScreenTheme`, which restores the previous theme on
 * blur): the daisy built-in of the same colour scheme, with the zero theme's
 * own `base-100` / `base-content` from its registry swatch. Then the page is
 * one colour edge to edge and the bar icons follow the scheme.
 *
 * This module is the pure half — no runtime imports — so it can be unit
 * tested; `ZeroGallery.tsx` registers and applies the result.
 */
import type { ThemeInfo } from '@sigx/lynx-zero';

export interface PageTheme {
    /** The app (legacy daisy) theme to derive from: same colour scheme. */
    base: 'daisy-light' | 'daisy-dark';
    /** The derived app theme, named after the zero theme. */
    name: string;
    variant: 'light' | 'dark';
    colors: { 'base-100': string; 'base-content': string };
}

/**
 * The app theme that mirrors zero theme `info`, or `null` when there is
 * nothing to mirror (an unknown theme, or a swatch without the base colours).
 */
export function pageThemeOf(info: ThemeInfo | undefined): PageTheme | null {
    const base100 = info?.swatch?.['base-100'];
    const content = info?.swatch?.['base-content'];
    if (!info || !base100 || !content) return null;
    const variant = info.colorScheme === 'dark' ? 'dark' : 'light';
    return {
        base: variant === 'dark' ? 'daisy-dark' : 'daisy-light',
        name: `zero-gallery-${info.name}`,
        variant,
        colors: { 'base-100': base100, 'base-content': content },
    };
}
