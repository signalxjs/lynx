/**
 * daisyUI theming for `@sigx/lynx-markdown`'s `MarkdownEditor`.
 *
 * The native `<sigx-richtext>` element can't read CSS custom properties — its
 * color props need concrete hex values (and the built-in theme tokens are
 * oklch, which Lynx's CSS engine can't parse anyway). This hook resolves the
 * **active theme's palette** to the editor's color props, reactively: read the
 * returned getters inside render and a theme switch recolors the editor.
 *
 * ```tsx
 * const editorTheme = useMarkdownEditorTheme();
 *
 * <MarkdownEditor
 *   textColor={editorTheme.textColor}
 *   accentColor={editorTheme.accentColor}
 *   placeholderColor={editorTheme.placeholderColor}
 *   …
 * />
 * ```
 */

import { useTheme } from '../theme/ThemeProvider.js';
import { colorsOf, type ThemePalette } from '../theme/registry.js';

export interface MarkdownEditorThemeColors {
    /** `base-content` — the theme's text color. */
    readonly textColor: string;
    /** `primary` — caret tint + links. */
    readonly accentColor: string;
    /** `base-content` at 40% alpha. */
    readonly placeholderColor: string;
}

/**
 * Resolve the active daisyUI theme into `MarkdownEditor` color props.
 * Getters are reactive via the theme controller's `name` — read them in
 * render (e.g. spread onto the editor's props) to track theme switches.
 */
export function useMarkdownEditorTheme(): MarkdownEditorThemeColors {
    const theme = useTheme();
    const palette = (): ThemePalette =>
        colorsOf(theme.name) ?? colorsOf('daisy-light')!;
    return {
        get textColor() {
            return palette()['base-content'];
        },
        get accentColor() {
            return palette()['primary'];
        },
        get placeholderColor() {
            return withAlpha(palette()['base-content'], '66'); // ~40%
        },
    };
}

/** Append an alpha byte to a hex color (`#RGB`/`#RRGGBB` → `#RRGGBBAA`). */
function withAlpha(hex: string, alpha: string): string {
    let h = hex.trim();
    if (!h.startsWith('#')) return h;
    h = h.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return `#${h}${alpha}`;
}
