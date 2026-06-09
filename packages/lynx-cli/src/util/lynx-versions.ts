/**
 * Helpers for `sigx doctor`'s `@sigx/lynx-*` version check.
 *
 * The `@sigx/lynx-*` packages are **lockstep** — every publishable package
 * shares one version, so a project must have them all at the same version.
 * Mixed versions (a partial update) cause subtle runtime breaks; being behind
 * the latest release means missing fixes (e.g. the #342 fetch fix, where a
 * stale `@sigx/lynx-http` made `res.ok` false on real 200s).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read installed `@sigx/lynx-*` versions from a project's `node_modules`. */
export function collectLynxVersions(cwd: string): Map<string, string> {
    const out = new Map<string, string>();
    const scope = join(cwd, 'node_modules', '@sigx');
    if (!existsSync(scope)) return out;
    let dirs: string[];
    try {
        dirs = readdirSync(scope).sort(); // sorted → deterministic group/name order downstream
    } catch {
        return out;
    }
    for (const dir of dirs) {
        if (!dir.startsWith('lynx')) continue;
        try {
            const pkg = JSON.parse(readFileSync(join(scope, dir, 'package.json'), 'utf-8')) as { version?: string };
            if (typeof pkg.version === 'string') out.set(`@sigx/${dir}`, pkg.version);
        } catch {
            // unreadable / non-package dir — skip
        }
    }
    return out;
}

/** Group package names by their version. */
export function groupByVersion(versions: Map<string, string>): Map<string, string[]> {
    const byVersion = new Map<string, string[]>();
    for (const [name, version] of versions) {
        const list = byVersion.get(version) ?? [];
        list.push(name);
        byVersion.set(version, list);
    }
    return byVersion;
}

/** Compare two `x.y.z` versions (prerelease/build ignored): 1 if a>b, -1 if a<b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
    const parse = (v: string): number[] => v.split('-')[0].split('+')[0].split('.').map((n) => Number(n) || 0);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 3; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

/**
 * Verdict for a project's installed `@sigx/lynx-*` set.
 * - `none`: no lynx packages installed.
 * - `skew`: more than one version present (lockstep violation).
 * - `ok`: all aligned at `version`.
 */
export type LynxVersionVerdict =
    | { kind: 'none' }
    | { kind: 'skew'; groups: Array<{ version: string; names: string[] }> }
    | { kind: 'ok'; version: string };

export function assessLynxVersions(versions: Map<string, string>): LynxVersionVerdict {
    if (versions.size === 0) return { kind: 'none' };
    const byVersion = groupByVersion(versions);
    if (byVersion.size > 1) {
        const groups = [...byVersion.entries()]
            .map(([version, names]) => ({ version, names: [...names].sort() }))
            // most-common version first; tie-break by version (newest first) for stable output
            .sort((a, b) => b.names.length - a.names.length || compareSemver(b.version, a.version));
        return { kind: 'skew', groups };
    }
    return { kind: 'ok', version: [...byVersion.keys()][0] };
}
