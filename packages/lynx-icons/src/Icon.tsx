import { component, useFontScale, type Define } from '@sigx/lynx';
import { codepoints } from '@sigx/lynx-icons/__codepoints';
import { svgs } from '@sigx/lynx-icons/__svgs';
import '@sigx/lynx-icons/__font-face.css';
import { lookupGlyph } from './registry.js';
// The resolver DI key lives in the CSS-free `./context.js` (so the theme engine
// can provide it without importing this asset-heavy module). `<Icon>` consumes it.
import { useIconColorResolver } from './context.js';
import { resolveSvgColor } from './svg-color.js';
import type { IconPropsExtensions } from './types.js';

export type IconProps =
    & Define.Prop<'set', string, true>
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>
    /**
     * Follow the OS text-size setting (#776). Default `false`: the icon holds
     * its designed `size` in dp regardless of the system font scale — the
     * layout-stable choice for chrome (tab bars, headers, list accessories).
     * Set `true` for icons sitting inline with scaling text: glyph AND box
     * grow together by the effective scale, live, on every backend (svg and
     * font mode behave identically).
     */
    & Define.Prop<'scaleWithText', boolean, false>
    /**
     * Augmentation point — theme packages declaration-merge into
     * `IconPropsExtensions` to add their own typed props (e.g. daisy
     * adds `variant?: DaisyColor`). Core declares no specific
     * extensions, so without a theme installed, no extra props exist
     * and the type system rejects `<Icon variant="…">` at compile time.
     */
    & IconPropsExtensions;

/**
 * Render a glyph from a registered icon set.
 *
 * Sets are declared in `signalx.config.ts` via `iconSets: [...]` (build-time,
 * tree-shaken) or via `defineIconSet({ id, glyphs })` (runtime, ad-hoc).
 *
 * Resolution order: **SVG first**, then codepoint, then missing placeholder.
 *
 * - SVG-mode sets render with Lynx's native `<svg content={...}>` element
 *   (the engine parses the inline XML; no JSX children, no data: URIs).
 *   Glyph markup is standard SVG painting from `currentColor`; on native the
 *   resolved color rides the element's `current-color` attribute (Lynx 4.0+),
 *   on web it is substituted into the markup (`svg-color.web.ts`).
 * - Font-mode sets fall back to a single character inside a `<text>` element
 *   with a matching `font-family`. The plugin only emits codepoints when the
 *   matching `@font-face` has also been registered (v1.1+); v1 always hits
 *   the SVG branch.
 * - Missing glyphs render an empty `<view>` of the same size so layout
 *   doesn't jump.
 *
 * @example
 * ```tsx
 * <Icon set="fa" name="user" size={20} color="#333" />
 * <Icon set="lucide" name="search" size={16} />
 * ```
 */
export const Icon = component<IconProps>(({ props }) => {
    // Resolve the active theme's color resolver once at setup. The
    // resolver itself is a stable function reference; it reads the
    // theme-augmented props (e.g. `props.variant` for daisy) and any
    // reactive theme state (e.g. `theme.name`) on each call.
    const resolveColor = useIconColorResolver();
    const fontScale = useFontScale();
    return () => {
        const size = props.size ?? 16;
        const set = props.set;
        const name = props.name;
        // Effective OS font scale (1 when unwired — web preview, tests). The
        // engine multiplies font-relevant lengths (fontSize/lineHeight) by
        // this; layout lengths (width/height) it never touches. Two coherent
        // behaviors fall out (#776):
        //  - pinned (default): box stays `size`; the glyph's fontSize is
        //    counter-divided so the engine's multiply lands it back on `size`.
        //  - scaleWithText: box grows to `size * s`; the glyph's fontSize is
        //    passed as `size` and the engine scales it to match.
        const s = fontScale.value;
        const scaled = props.scaleWithText === true;
        const box = scaled ? size * s : size;
        const sizeStyle = { width: box, height: box } as const;
        // Resolution order: explicit `props.color` wins → then the
        // theme resolver's return (driven by augmented props like
        // `variant`) → finally `currentColor`. Handed to the glyph by
        // `resolveSvgColor` (native: the `current-color` attribute; web:
        // substituted into the markup); class is not used to convey color
        // because Lynx's `<svg content=…>` parses the SVG string in
        // isolation and never inherits host CSS `color`.
        //
        // `props` is cast to the unknown-record shape the resolver
        // signature expects — at compile time the augmented fields are
        // typed correctly inside the resolver itself (where the theme
        // package's augmentation is in scope).
        const themeColor = resolveColor
            ? resolveColor(props as unknown as Readonly<Record<string, unknown>>)
            : undefined;
        const color = props.color ?? themeColor ?? 'currentColor';

        const glyph = lookupGlyph(codepoints, svgs, set, name);
        if (glyph?.svg) {
            const resolved = resolveSvgColor(glyph.svg.svg, color);
            return (
                <svg
                    content={resolved.content}
                    current-color={resolved.currentColor}
                    class={props.class}
                    style={sizeStyle}
                />
            );
        }

        if (glyph?.codepoint !== undefined) {
            const glyphSize = scaled ? size : size / s;
            const textStyle: Record<string, string | number> = {
                fontFamily: set,
                fontSize: glyphSize,
                lineHeight: `${glyphSize}px`,
                width: box,
                height: box,
                color,
            };
            return (
                <text class={props.class} style={textStyle}>
                    {String.fromCodePoint(glyph.codepoint)}
                </text>
            );
        }

        return <view class={props.class} style={sizeStyle} />;
    };
});
