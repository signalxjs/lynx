/**
 * Match a conservative subset of valid CSS color formats:
 * - `currentColor` and named colors (`red`, `dodgerblue`, `transparent` …)
 * - `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`
 * - `rgb(...)` / `rgba(...)` / `hsl(...)` / `hsla(...)` with digits, dots,
 *   commas, percent signs, and whitespace inside the parens
 * - `var(--name)` referencing a CSS custom property. Neither the native
 *   `current-color` attribute nor the SVG parser evaluates `var()` today
 *   (probed on Lynx 4.0.1, #949), so theme packages resolve tokens to a
 *   palette hex before they reach `<Icon>`; the form is accepted so nothing
 *   here blocks the day the engine grows that support.
 *
 * Anything else (quotes, angle brackets, ampersands, arbitrary HTML) falls
 * back to `currentColor`. On web the `color` prop is substituted directly
 * into the SVG markup handed to `<svg content={…}>`, so a value like
 * `red" stroke="…` would break out of the `fill=""` attribute. Allow-list,
 * not escape-list — keeps the surface area provably small. The same
 * sanitized value is what native receives as the `current-color` attribute,
 * so both transports see one vocabulary.
 */
const SAFE_COLOR_RE =
    /^(?:currentColor|[a-zA-Z]+|#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s]+\)|var\(\s*--[\w-]+\s*\))$/;

export function sanitizeColor(color: string): string {
    return SAFE_COLOR_RE.test(color) ? color : 'currentColor';
}

/**
 * Legacy placeholder. Icon sets used to ship `fill="__COLOR__"` so the
 * component could splice a color into the markup; standard
 * `fill="currentColor"` / `stroke="currentColor"` is the contract now, and
 * the placeholder is kept as an alias of `currentColor` so ad-hoc
 * `defineIconSet` glyphs written against the old shape keep rendering.
 *
 * Lives here, not in `svg-color.ts`, on purpose: this module has no `.web`
 * twin. The build resolves `./svg-color.js` to `svg-color.web.js` on the web
 * target for EVERY importer — including the twin itself — so anything both
 * transports share must sit in a file that is the same on both.
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
