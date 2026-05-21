import { component, type Define } from '@sigx/lynx';
import { codepoints } from '@sigx/lynx-icons/__codepoints';
import { svgs } from '@sigx/lynx-icons/__svgs';
import '@sigx/lynx-icons/__font-face.css';
import { lookupGlyph } from './registry.js';

export type IconProps =
    & Define.Prop<'set', string, true>
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>;

/**
 * Match a conservative subset of valid CSS color formats:
 * - `currentColor` and named colors (`red`, `dodgerblue`, `transparent` …)
 * - `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`
 * - `rgb(...)` / `rgba(...)` / `hsl(...)` / `hsla(...)` with digits, dots,
 *   commas, percent signs, and whitespace inside the parens
 *
 * Anything else (quotes, angle brackets, ampersands, arbitrary HTML) falls
 * back to `currentColor`. The `color` prop ends up substituted directly into
 * the SVG markup that we hand to Lynx's `<svg content={…}>` parser, so a
 * value like `red" stroke="…` would break out of the `fill=""` attribute.
 * Allow-list, not escape-list — keeps the surface area provably small.
 */
const SAFE_COLOR_RE =
    /^(?:currentColor|[a-zA-Z]+|#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s]+\))$/;

export function sanitizeColor(color: string): string {
    return SAFE_COLOR_RE.test(color) ? color : 'currentColor';
}

export function inlineSvg(template: string, color: string): string {
    return template.replace(/__COLOR__/g, sanitizeColor(color));
}

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
    return () => {
        const size = props.size ?? 16;
        const set = props.set;
        const name = props.name;
        const sizeStyle = { width: size, height: size } as const;

        const glyph = lookupGlyph(codepoints, svgs, set, name);
        if (glyph?.svg) {
            const color = props.color ?? 'currentColor';
            return (
                <svg
                    content={inlineSvg(glyph.svg.svg, color)}
                    class={props.class}
                    style={sizeStyle}
                />
            );
        }

        if (glyph?.codepoint !== undefined) {
            const textStyle: Record<string, string | number> = {
                fontFamily: set,
                fontSize: size,
                lineHeight: `${size}px`,
                width: size,
                height: size,
            };
            if (props.color) textStyle.color = props.color;
            return (
                <text class={props.class} style={textStyle}>
                    {String.fromCodePoint(glyph.codepoint)}
                </text>
            );
        }

        return <view class={props.class} style={sizeStyle} />;
    };
});
