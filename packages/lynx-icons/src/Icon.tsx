import { component, type Define } from '@sigx/lynx';
import { codepoints } from '@sigx/lynx-icons/__codepoints';
import { svgs } from '@sigx/lynx-icons/__svgs';
import '@sigx/lynx-icons/__font-face.css';
import { lookupCodepoint, lookupSvg } from './registry';

export type IconProps =
    & Define.Prop<'set', string, true>
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>;

function svgDataUri(template: string, color: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(template.replace(/__COLOR__/g, color))}`;
}

/**
 * Render a glyph from a registered icon set.
 *
 * Sets are declared in `sigx.lynx.config.ts` via `iconSets: [...]` (build-time,
 * tree-shaken) or via `defineIconSet({ id, glyphs })` (runtime, ad-hoc).
 *
 * Font-mode sets render as a single character inside a `<text>` element with
 * a matching `font-family`. SVG-mode sets render as an `<image>` with an
 * SVG data URI. Missing glyphs render an empty `<view>` of the same size.
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

        const cp = lookupCodepoint(codepoints, set, name);
        if (cp !== undefined) {
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
                    {String.fromCodePoint(cp)}
                </text>
            );
        }

        const svg = lookupSvg(svgs, set, name);
        if (svg) {
            const color = props.color ?? 'currentColor';
            return (
                <image
                    src={svgDataUri(svg.svg, color)}
                    class={props.class}
                    style={sizeStyle}
                />
            );
        }

        return <view class={props.class} style={sizeStyle} />;
    };
});
