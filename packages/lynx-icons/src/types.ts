/**
 * Extension point: declaration-merge into this interface to add named
 * variants accepted by `<Icon variant=…>` and the adapter pinned
 * components. Each key becomes a valid variant string at the type level
 * and is forwarded at runtime to the `useIconVariantResolver` injectable
 * for class resolution.
 *
 * `@sigx/lynx-icons` itself defines no variants — the interface is empty
 * by default, so `IconVariant` is `never` and the `variant` prop is
 * effectively disabled until something augments it. Daisy augments with
 * its color tokens (`primary`, `secondary`, …); third-party themes can
 * augment further.
 *
 * @example
 * ```ts
 * // In a theme package:
 * declare module '@sigx/lynx-icons' {
 *     interface IconVariants {
 *         primary: true;
 *         secondary: true;
 *     }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IconVariants {}

/**
 * Valid variant strings. When `IconVariants` has been augmented (e.g. by
 * `@sigx/lynx-daisyui`), this narrows to the union of augmented keys.
 * When nothing has augmented it, falls back to `string` so the prop
 * stays usable — and the framework's JSX prop-stripping doesn't drop a
 * `never`-typed prop from pinned components built before any augmenter.
 */
export type IconVariant = [keyof IconVariants] extends [never]
    ? string
    : keyof IconVariants;

/**
 * Function form provided to `useIconVariantResolver`. Given a variant
 * string, return a **CSS color value** (e.g. `'var(--color-primary)'`,
 * `'#0D9488'`, `'tomato'`) that gets substituted into the rendered
 * SVG's `fill=` attribute. Return `undefined` to ignore a variant the
 * resolver doesn't recognize — in that case the icon falls back to
 * `props.color` or `currentColor`.
 *
 * Color rather than class: Lynx's `<svg content=…>` parses the inline
 * SVG markup as a standalone fragment that doesn't inherit `color` CSS
 * from the host element. Substituting the value into the markup is the
 * only reliable way to make theme tokens show through.
 */
export type IconVariantResolver = (variant: string) => string | undefined;

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
