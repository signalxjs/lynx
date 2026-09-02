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
