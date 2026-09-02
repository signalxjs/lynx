import { COLOR_PLACEHOLDER_RE, sanitizeColor, type ResolvedSvgColor } from './sanitize-color.js';

export type { ResolvedSvgColor } from './sanitize-color.js';

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
