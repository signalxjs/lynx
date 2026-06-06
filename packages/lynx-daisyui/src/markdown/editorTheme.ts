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

import { useThemeColors } from '@sigx/lynx-zero';


export interface MarkdownEditorThemeColors {
    /** `base-content` — the theme's text color. */
    readonly textColor: string;
    /** `primary` — caret tint + links. */
    readonly accentColor: string;
    /** `base-content` at 40% alpha. */
    readonly placeholderColor: string;
}

/**
 * Resolve the active theme into `MarkdownEditor` color props. Built on
 * `@sigx/lynx-zero`'s `useThemeColors()` (scoped + reactive: read the
 * getters in render and a theme switch recolors the editor).
 */
export function useMarkdownEditorTheme(): MarkdownEditorThemeColors {
    const colors = useThemeColors();
    return {
        get textColor() {
            return colors.colorOf('base-content');
        },
        get accentColor() {
            return colors.colorOf('primary');
        },
        get placeholderColor() {
            return colors.colorOf('base-content', 0.4);
        },
    };
}
