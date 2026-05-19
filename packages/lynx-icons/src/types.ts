/**
 * Per-glyph vector data. Used by SVG-mode rendering.
 *
 * `svg` is a complete `<svg …>…</svg>` string with `__COLOR__` placeholders
 * wherever the user-supplied `color` should be substituted. This lets each
 * adapter ship the native shape of its icons (FA = filled paths, lucide =
 * stroked paths) without the core component needing to know per-adapter
 * styling.
 *
 * @example FA solid: `<svg viewBox="0 0 448 512" fill="__COLOR__"><path d="..."/></svg>`
 * @example lucide:   `<svg viewBox="0 0 24 24" fill="none" stroke="__COLOR__" stroke-width="2" ...><path .../><circle .../></svg>`
 */
export interface GlyphSvg {
    svg: string;
}

/**
 * Build-time virtual module shape: glyph name → unicode codepoint, keyed by set id.
 * Populated by the @sigx/lynx-plugin icons slice; the stub ships an empty record
 * so the core package builds standalone.
 */
export type CodepointMap = Record<string, Record<string, number>>;

/**
 * Build-time virtual module shape: glyph name → SVG data, keyed by set id.
 * Populated by the @sigx/lynx-plugin icons slice.
 */
export type SvgMap = Record<string, Record<string, GlyphSvg>>;

/**
 * Runtime-registered icon set, for ad-hoc / app-local sets created via
 * `defineIconSet`. Build-time sets bypass this and live in the virtual modules.
 */
export interface IconSetDef {
    id: string;
    glyphs: Record<string, { codepoint?: number; svg?: GlyphSvg }>;
    fontFamily?: string;
}

/**
 * Glyph data exposed by an adapter package at build time.
 * `codepoint` enables font-mode subsetting; `svg` enables SVG-mode rendering.
 * Adapters should populate both when possible (FA does), or only `svg` for
 * SVG-only sets (e.g. lucide).
 *
 * `svg` is a complete `<svg>…</svg>` string with `__COLOR__` placeholders
 * for the user's color; see {@link GlyphSvg} for the rendering contract.
 */
export interface GlyphData {
    codepoint?: number;
    svg: string;
}

/**
 * Build-time adapter contract. Implemented by packages like
 * `@sigx/lynx-icons-fa-free` and consumed by `@sigx/lynx-plugin`'s icons slice
 * to resolve glyph data for every `<Icon set="..." name="..." />` usage.
 *
 * Adapters should expose a default export of this shape from their main entry.
 */
export interface IconAdapter {
    /** Style variants the adapter supports. e.g. ['solid', 'regular', 'brands'] for FA, [''] (single empty style) for lucide. */
    styles: string[];
    /** Resolve a glyph by style + name. Return `null` when the glyph is unknown. */
    getGlyph(style: string, name: string): GlyphData | null;
    /**
     * Absolute filesystem path to the source TTF for `style`, or null when the
     * adapter only supports SVG mode. The plugin reads this file and runs it
     * through `subset-font` to produce per-app subsets.
     */
    getFontPath(style: string): string | null;
}
