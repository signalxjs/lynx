import { component, defineInjectable, type Define } from '@sigx/lynx';
import { codepoints } from '@sigx/lynx-icons/__codepoints';
import { svgs } from '@sigx/lynx-icons/__svgs';
import '@sigx/lynx-icons/__font-face.css';
import { lookupGlyph } from './registry.js';
import type { IconColorResolver, IconPropsExtensions } from './types.js';

/**
 * Injectable for the active theme's color resolver. Receives the full
 * `<Icon>` props (including theme-augmented fields like daisy's
 * `variant`) and returns a CSS color value to substitute into the SVG
 * `fill=`, or `undefined` to fall through.
 *
 * Themes provide this via `defineProvide(useIconColorResolver, …)` from
 * inside a provider component (e.g. daisy's `<ThemeProvider>`). Core
 * `<Icon>` has no concept of named variants — it just asks the resolver
 * for a color.
 */
export const useIconColorResolver = defineInjectable<IconColorResolver | null>(() => null);

export type IconProps =
    & Define.Prop<'set', string, true>
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>
    /**
     * Augmentation point — theme packages declaration-merge into
     * `IconPropsExtensions` to add their own typed props (e.g. daisy
     * adds `variant?: DaisyColor`). Core declares no specific
     * extensions, so without a theme installed, no extra props exist
     * and the type system rejects `<Icon variant="…">` at compile time.
     */
    & IconPropsExtensions;

/**
 * Match a conservative subset of valid CSS color formats:
 * - `currentColor` and named colors (`red`, `dodgerblue`, `transparent` …)
 * - `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`
 * - `rgb(...)` / `rgba(...)` / `hsl(...)` / `hsla(...)` with digits, dots,
 *   commas, percent signs, and whitespace inside the parens
 * - `var(--name)` referencing a CSS custom property — the only way to
 *   plumb theme tokens (`var(--color-primary)`) into the SVG `fill=`
 *   attribute, since Lynx's `<svg content=…>` parses the SVG string as
 *   a standalone fragment that doesn't inherit `color` from the host
 *   element (so `fill="currentColor"` + a host-level class is a no-op).
 *
 * Anything else (quotes, angle brackets, ampersands, arbitrary HTML) falls
 * back to `currentColor`. The `color` prop ends up substituted directly into
 * the SVG markup that we hand to Lynx's `<svg content={…}>` parser, so a
 * value like `red" stroke="…` would break out of the `fill=""` attribute.
 * Allow-list, not escape-list — keeps the surface area provably small.
 */
const SAFE_COLOR_RE =
    /^(?:currentColor|[a-zA-Z]+|#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s]+\)|var\(\s*--[\w-]+\s*\))$/;

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
    // Resolve the active theme's color resolver once at setup. The
    // resolver itself is a stable function reference; it reads the
    // theme-augmented props (e.g. `props.variant` for daisy) and any
    // reactive theme state (e.g. `theme.name`) on each call.
    const resolveColor = useIconColorResolver();
    return () => {
        const size = props.size ?? 16;
        const set = props.set;
        const name = props.name;
        const sizeStyle = { width: size, height: size } as const;
        // Resolution order: explicit `props.color` wins → then the
        // theme resolver's return (driven by augmented props like
        // `variant`) → finally `currentColor`. Substituted directly
        // into the SVG `fill=` attribute by `inlineSvg`; class is not
        // used to convey color because Lynx's `<svg content=…>` parses
        // the SVG string in isolation and doesn't inherit host CSS
        // `color`.
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
