/**
 * Augmentation point for theme / extension packages. Declaration-merge
 * into this interface to add fields that `<Icon>` accepts beyond the
 * core props. The pinned components in adapter packages and the daisy
 * navigation primitives inherit the augmentation automatically via
 * intersection.
 *
 * `@sigx/lynx-icons` deliberately knows nothing about themes — the
 * extension shape is up to whatever theme is installed. Daisy adds a
 * `variant?: DaisyColor` field; a custom theme could add anything else
 * (`tone?: 'muted' | 'loud'`, `tint?: number`, …) and provide its own
 * resolver.
 *
 * @example
 * ```ts
 * // In a theme package:
 * declare module '@sigx/lynx-icons' {
 *     interface IconPropsExtensions {
 *         variant?: 'primary' | 'secondary' | 'accent';
 *     }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IconPropsExtensions {}

/**
 * Function form provided to `useIconColorResolver`. Receives the full
 * `<Icon>` props (including whatever fields the active theme augmented
 * onto `IconPropsExtensions`) and returns a **CSS color value**
 * substituted into the rendered SVG's `fill=` attribute. Return
 * `undefined` to fall through to `props.color` / `currentColor`.
 *
 * Color rather than class: Lynx's `<svg content=…>` parses the inline
 * SVG markup as a standalone fragment that doesn't inherit `color` CSS
 * from the host element. Substituting the value into the markup is the
 * only reliable way to make theme tokens show through.
 *
 * Props rather than a single variant string: the core has no opinion on
 * how a theme keys its colors. A theme picks whichever augmented field
 * (or combination) makes sense and reads it from `props` itself.
 */
export type IconColorResolver = (
    props: Readonly<Record<string, unknown>>,
) => string | undefined;

/**
 * Lightweight `{ set, name }` reference to an icon in a registered set —
 * the canonical "data" form a consumer can pass to a UI primitive that
 * accepts an icon (e.g. `<Tabs.Screen icon={{ set: 'lucide', name: 'map' }}>`).
 *
 * The receiving component (e.g. `<NavTabBar>`, `<NavHeader>`) is responsible
 * for turning the spec into rendered JSX — typically by composing
 * `<Icon set={spec.set} name={spec.name} color="currentColor" size={…}>`
 * with theme-aware wrapping. Consumers who want full control (custom
 * color, third-party component, size override) pass JSX directly instead
 * of a spec.
 */
export interface IconSpec {
    readonly set: string;
    readonly name: string;
}

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
    /**
     * Enumerate every glyph name the adapter can resolve for `style`, in
     * the same kebab-case form `getGlyph` accepts. Used by the plugin when
     * a project sets `iconSets[].include: ['*']` (e.g. JSON-driven UIs where
     * the names aren't known at build time) — the plugin pulls the full
     * catalog into the bundle instead of relying on the JSX scanner.
     */
    listGlyphs(style: string): string[];
}
