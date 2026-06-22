import { assertValidVariantName } from '../config/variant.js';

/**
 * Resolve the active build variant for a CLI command (issue #530).
 *
 * Precedence: the explicit `--variant <name>` flag wins, then the `SIGX_VARIANT`
 * environment variable (so CI / scripts can set it once instead of on every
 * command), then undefined (the base / production identity). The resolved name
 * is validated up front (it flows into filesystem dir names) so commands fail
 * fast with a clear error rather than computing a malformed path.
 */
export function resolveVariantName(args: Record<string, unknown>): string | undefined {
    const flag = args['variant'];
    // `a.string()` yields the value for `--variant dev`; a bare `--variant`
    // with no value can surface as `true` — treat that as "not set".
    let name: string | undefined;
    if (typeof flag === 'string' && flag.trim() && flag !== 'true') {
        name = flag.trim();
    } else {
        const env = process.env['SIGX_VARIANT'];
        if (env && env.trim()) name = env.trim();
    }
    if (name === undefined) return undefined;
    assertValidVariantName(name);
    return name;
}
