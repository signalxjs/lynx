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
