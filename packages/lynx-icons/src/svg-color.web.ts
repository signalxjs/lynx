import { COLOR_PLACEHOLDER_RE, sanitizeColor, type ResolvedSvgColor } from './sanitize-color.js';

/**
 * `currentColor` wherever SVG paints from it: `fill`, `stroke`, gradient
 * `stop-color`, and the presentation `color` attribute. Attribute form only —
 * the adapters and the documented `defineIconSet` shape write attributes,
 * not `style=""` declarations.
 */
const CURRENT_COLOR_ATTR_RE = /\b(fill|stroke|stop-color|color)="currentColor"/g;

/**
 * Substitute the resolved color into the markup: the legacy `__COLOR__`
 * placeholder and every `currentColor` paint attribute. The color has been
 * through the allow-list, so it cannot carry a quote or a bracket into the
 * attribute it lands in.
 */
export function inlineSvg(template: string, color: string): string {
    const safe = sanitizeColor(color);
    return template
        .replace(COLOR_PLACEHOLDER_RE, safe)
        .replace(CURRENT_COLOR_ATTR_RE, (_m, attr: string) => `${attr}="${safe}"`);
}

/**
 * Web transport: `@lynx-js/web-core` maps `<svg content>` to upstream's
 * `x-svg`, which turns the markup into a blob URL on an `<img>` — parsed in
 * isolation, no `current-color` attribute, no inherited `color`. The only
 * way to color the glyph is to write the color into the markup, so this twin
 * does what native no longer has to.
 */
export function resolveSvgColor(template: string, color: string): ResolvedSvgColor {
    return { content: inlineSvg(template, color), currentColor: undefined };
}
