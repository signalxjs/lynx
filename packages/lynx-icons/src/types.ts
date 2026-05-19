/**
 * Per-glyph vector data. Used by SVG-mode rendering.
 * `path` is a single SVG path 'd' attribute; viewBox is `0 0 w h`.
 */
export interface GlyphSvg {
    w: number;
    h: number;
    path: string;
}

/**
 * Build-time virtual module shape: glyph name → unicode codepoint, keyed by set id.
 * Populated by the @sigx/lynx-plugin icons slice; the stub ships an empty record
 * so the core package builds standalone.
 */
export type CodepointMap = Record<string, Record<string, number>>;

/**
 * Build-time virtual module shape: glyph name → SVG path data, keyed by set id.
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
 * `codepoint` enables font-mode subsetting; `w`/`h`/`path` enable SVG-mode rendering.
 * Adapters should populate both when possible (FA does), or only the SVG fields
 * for SVG-only sets (e.g. lucide).
 */
export interface GlyphData {
    codepoint?: number;
    w: number;
    h: number;
    path: string;
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
