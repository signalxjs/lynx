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

import { useTheme, colorsOf, type ThemePalette } from '@sigx/lynx-zero';


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
            return toHex(palette()['base-content']);
        },
        get accentColor() {
            return toHex(palette()['primary']);
        },
        get placeholderColor() {
            return withAlpha(toHex(palette()['base-content']), '66'); // ~40%
        },
    };
}

/**
 * Normalize a palette color to hex — the registry allows `rgb()`/`rgba()`
 * entries, but the native `<sigx-richtext>` color parsers are hex-only.
 */
function toHex(color: string): string {
    const c = color.trim();
    if (c.startsWith('#')) return c;
    const m = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(c);
    if (!m) return c; // unknown notation — pass through unchanged
    const byte = (v: string): string =>
        Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0');
    let hex = `#${byte(m[1])}${byte(m[2])}${byte(m[3])}`;
    if (m[4] !== undefined) {
        const a = m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
        hex += byte(String(Math.max(0, Math.min(1, a)) * 255));
    }
    return hex;
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
