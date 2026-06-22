/**
 * Resolve the active build variant for a CLI command (issue #530).
 *
 * Precedence: the explicit `--variant <name>` flag wins, then the `SIGX_VARIANT`
 * environment variable (so CI / scripts can set it once instead of on every
 * command), then undefined (the base / production identity).
 */
export function resolveVariantName(args: Record<string, unknown>): string | undefined {
    const flag = args['variant'];
    // `a.string()` yields the value for `--variant dev`; a bare `--variant`
    // with no value can surface as `true` — treat that as "not set".
    if (typeof flag === 'string' && flag.trim() && flag !== 'true') return flag.trim();
    const env = process.env['SIGX_VARIANT'];
    if (env && env.trim()) return env.trim();
    return undefined;
}
