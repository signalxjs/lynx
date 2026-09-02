import { sanitizeColor } from './sanitize-color.js';

/**
 * Legacy placeholder. Icon sets used to ship `fill="__COLOR__"` so the
 * component could splice a color into the markup; standard
 * `fill="currentColor"` / `stroke="currentColor"` is the contract now, and
 * the placeholder is kept as an alias of `currentColor` so ad-hoc
 * `defineIconSet` glyphs written against the old shape keep rendering.
 */
export const COLOR_PLACEHOLDER_RE = /__COLOR__/g;

export interface ResolvedSvgColor {
    /** The markup to hand to `<svg content={…}>`. */
    content: string;
    /**
     * The value for the element's `current-color` attribute, or `undefined`
     * when there is nothing to inject (the color resolved to `currentColor`
     * itself — the engine's own fallback paints).
     */
    currentColor: string | undefined;
}

/**
 * Native transport (iOS / Android, Lynx 4.0+): the markup goes to the engine
 * untouched, with `currentColor` left in place, and the resolved color rides
 * the `current-color` attribute — *"host-injected default color used to
 * resolve `currentColor` in SVG content; does not override explicit `fill` /
 * `stroke`"*. Probed on device in #949: concrete colors resolve, `var()`
 * does not, and the host's CSS `color` is still never inherited.
 *
 * `svg-color.web.ts` is the web twin: `@lynx-js/web-core`'s `x-svg` renders
 * the markup as a blob-URL `<img>` and has no `current-color`, so there the
 * color is substituted into the markup instead.
 */
export function resolveSvgColor(template: string, color: string): ResolvedSvgColor {
    const safe = sanitizeColor(color);
    return {
        content: template.replace(COLOR_PLACEHOLDER_RE, 'currentColor'),
        currentColor: safe === 'currentColor' ? undefined : safe,
    };
}
