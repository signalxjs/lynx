/**
 * Path template compiler.
 *
 * Turns a route's `path` (e.g. `/users/:id/posts/:postId`) into a compiled
 * object that can both match a URL pathname against it and format a typed
 * params object back into a URL.
 *
 * Supported syntax (intentionally minimal for v1):
 *   - Literal segments:  `/users`, `/users/me`
 *   - Named params:      `:id` (matches `[^/]+`)
 *   - Trailing slashes tolerated on match
 *
 * Out of scope for v1 (future-compatible — additions won't break v1 paths):
 *   - Wildcards `*`
 *   - Optional params `:id?`
 *   - Typed/constrained params `:id<number>` or `:id(\\d+)`
 */

/** Result of compiling a path template — used by parse + format. */
export interface CompiledPath {
    readonly source: string;
    readonly paramNames: readonly string[];
    /** Regex that matches a URL pathname. Captures are param values in order. */
    readonly regex: RegExp;
    /**
     * Render a URL pathname for this template given param values. Each value
     * is `encodeURIComponent`-encoded. Throws if a required `:name` is missing.
     */
    format(params: Record<string, string | number>): string;
}

const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Compile a path template. Throws on malformed input (duplicate param names,
 * unexpected `:` syntax). Pure — safe to memoize.
 */
export function compilePath(template: string): CompiledPath {
    if (typeof template !== 'string') {
        throw new TypeError(`compilePath: expected string, got ${typeof template}`);
    }
    if (template.length === 0) {
        throw new Error('compilePath: path template must not be empty');
    }
    // Normalize: ensure leading `/`. Trailing slashes are tolerated on match,
    // but the canonical formatted output preserves the template's trailing
    // slash policy.
    const normalized = template.startsWith('/') ? template : `/${template}`;

    const paramNames: string[] = [];
    // Build the regex by replacing :name with a capture group. We escape the
    // surrounding literal text so paths with regex-special chars (`.`, `+`)
    // match literally — only `:name` is treated as a placeholder.
    let lastIndex = 0;
    let pattern = '';
    PARAM_RE.lastIndex = 0;
    for (let m = PARAM_RE.exec(normalized); m !== null; m = PARAM_RE.exec(normalized)) {
        const name = m[1];
        if (paramNames.includes(name)) {
            throw new Error(
                `compilePath: duplicate param name ':${name}' in '${template}'`,
            );
        }
        paramNames.push(name);
        pattern += escapeRegex(normalized.slice(lastIndex, m.index));
        pattern += '([^/]+)';
        lastIndex = m.index + m[0].length;
    }
    pattern += escapeRegex(normalized.slice(lastIndex));

    // Trim a trailing slash from the pattern so `/users/` and `/users` both
    // match `/users/:?`. We keep the formatter's output as-templated.
    const matchPattern = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    const regex = new RegExp(`^${matchPattern}/?$`);

    return {
        source: template,
        paramNames,
        regex,
        format(params: Record<string, string | number>): string {
            let out = '';
            let i = 0;
            PARAM_RE.lastIndex = 0;
            for (
                let m = PARAM_RE.exec(normalized);
                m !== null;
                m = PARAM_RE.exec(normalized)
            ) {
                const name = m[1];
                const value = params[name];
                if (value === undefined || value === null) {
                    throw new Error(
                        `compilePath.format: missing required param ':${name}' for '${template}'`,
                    );
                }
                out += normalized.slice(i, m.index);
                out += encodeURIComponent(String(value));
                i = m.index + m[0].length;
            }
            out += normalized.slice(i);
            return out;
        },
    };
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
    return s.replace(REGEX_SPECIALS, '\\$&');
}
