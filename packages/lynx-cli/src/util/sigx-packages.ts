/**
 * Read and rewrite @sigx/lynx-* deps in a project's package.json.
 *
 * The lockstep contract (per scripts/check-versions.js): every @sigx/lynx-*
 * package in a project should share one version. These helpers find,
 * classify, and rewrite those entries while preserving the user's range
 * style (`^x.y.z`, `~x.y.z`, exact `x.y.z`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SIGX_LYNX_PREFIX = '@sigx/lynx-';

export type DepSection = 'dependencies' | 'devDependencies' | 'peerDependencies';

export const DEP_SECTIONS: DepSection[] = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
];

export interface SigxDep {
    name: string;
    section: DepSection;
    /** Raw range as written in package.json, e.g. "^0.4.0" */
    range: string;
    /** Parsed numeric version, e.g. "0.4.0", or null if range is a tag/workspace ref */
    version: string | null;
    /** "^", "~", or "" for exact */
    rangePrefix: '^' | '~' | '';
    /** True for workspace:^, workspace:*, etc. — leave these alone. */
    isWorkspace: boolean;
}

export interface PackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    [key: string]: unknown;
}

export function readPackageJson(cwd: string): PackageJson | null {
    const file = join(cwd, 'package.json');
    if (!existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf-8')) as PackageJson;
    } catch {
        return null;
    }
}

export function isSigxLynxName(name: string): boolean {
    return name.startsWith(SIGX_LYNX_PREFIX);
}

export function expandShortName(name: string): string {
    if (name.startsWith('@')) return name;
    return `${SIGX_LYNX_PREFIX}${name}`;
}

function parseRange(range: string): Pick<SigxDep, 'version' | 'rangePrefix' | 'isWorkspace'> {
    if (range.startsWith('workspace:')) {
        return { version: null, rangePrefix: '^', isWorkspace: true };
    }
    const m = range.match(/^(\^|~)?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
    if (m) {
        return {
            version: m[2],
            rangePrefix: (m[1] as '^' | '~' | undefined) ?? '',
            isWorkspace: false,
        };
    }
    return { version: null, rangePrefix: '^', isWorkspace: false };
}

/** All @sigx/lynx-* deps in a package.json across all dep sections. */
export function findSigxDeps(pkg: PackageJson): SigxDep[] {
    const result: SigxDep[] = [];
    for (const section of DEP_SECTIONS) {
        const deps = pkg[section];
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (!isSigxLynxName(name)) continue;
            result.push({ name, section, range, ...parseRange(range) });
        }
    }
    return result;
}

/**
 * Pick the dominant version from a set of sigx deps. Used by `add` to
 * resolve "the version the user is on". Returns the most common non-null
 * version, or null if there's no signal (no deps, or all workspace refs).
 */
export function dominantVersion(deps: SigxDep[]): string | null {
    const counts = new Map<string, number>();
    for (const d of deps) {
        if (!d.version) continue;
        counts.set(d.version, (counts.get(d.version) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [v, n] of counts) {
        if (n > bestCount) { best = v; bestCount = n; }
    }
    return best;
}

/**
 * Resolve the installed version of a package from node_modules.
 * Falls back to null if not installed.
 */
export function readInstalledVersion(cwd: string, pkgName: string): string | null {
    const file = join(cwd, 'node_modules', pkgName, 'package.json');
    if (!existsSync(file)) return null;
    try {
        const pkg = JSON.parse(readFileSync(file, 'utf-8')) as { version?: string };
        return pkg.version ?? null;
    } catch {
        return null;
    }
}

/**
 * Pure-JS @sigx/lynx-* packages — no native code, so changing their version
 * never requires a prebuild. Anything not on this list is treated as
 * potentially native and triggers the prebuild hint.
 */
const PURE_JS_LYNX_PACKAGES = new Set([
    '@sigx/lynx',
    '@sigx/lynx-cli',
    '@sigx/lynx-core',
    '@sigx/lynx-plugin',
    '@sigx/lynx-runtime',
    '@sigx/lynx-runtime-internal',
    '@sigx/lynx-runtime-main',
    '@sigx/lynx-testing',
    '@sigx/lynx-dev-client',
    '@sigx/lynx-daisyui',
    '@sigx/lynx-icons',
    '@sigx/lynx-icons-fa-free',
    '@sigx/lynx-icons-lucide',
]);

/**
 * True if any of the given package names is a native (auto-linked) module.
 * Used to decide whether to print the post-upgrade prebuild hint.
 *
 * Heuristic: pure-JS names are hard-coded; anything else is treated as
 * native. Verified against node_modules/<name>/lynx-module.json when
 * available — that's the source of truth for "this package autolinks".
 */
export function hasNativeModule(cwd: string, pkgNames: string[]): boolean {
    for (const name of pkgNames) {
        if (PURE_JS_LYNX_PACKAGES.has(name)) continue;
        // If we can confirm via manifest, do so; otherwise trust the deny-list.
        const manifestPath = join(cwd, 'node_modules', name, 'lynx-module.json');
        if (existsSync(manifestPath)) return true;
        if (!isSigxLynxName(name)) continue;
        return true;
    }
    return false;
}

export function buildRange(version: string, prefix: '^' | '~' | '' | 'exact'): string {
    if (prefix === 'exact') return version;
    return `${prefix}${version}`;
}

/**
 * Rewrite a package.json string (preserving formatting where possible) so
 * that the given sigx deps point at `targetVersion`.
 *
 * Returns the new package.json text and the list of entries that actually
 * changed. Workspace refs are skipped.
 */
export function rewritePackageJson(
    source: string,
    deps: SigxDep[],
    targetVersion: string,
    options: { exact?: boolean } = {},
): { text: string; changes: Array<{ dep: SigxDep; newRange: string }> } {
    const pkg = JSON.parse(source) as PackageJson;
    const changes: Array<{ dep: SigxDep; newRange: string }> = [];

    for (const dep of deps) {
        if (dep.isWorkspace) continue;
        // Non-semver ranges (git URLs, file:, tags) aren't safe to rewrite —
        // we don't know what shape the user wants them in.
        if (dep.version === null) continue;
        const prefix = options.exact ? '' : dep.rangePrefix;
        const newRange = buildRange(targetVersion, prefix);
        if (newRange === dep.range) continue;
        const section = pkg[dep.section];
        if (section && typeof section === 'object') {
            (section as Record<string, string>)[dep.name] = newRange;
        }
        changes.push({ dep, newRange });
    }

    // Preserve trailing newline + 2-space indent (matches what `npm`/`pnpm`
    // write back). Detect indent from the source if possible.
    const indent = detectIndent(source);
    const trailingNewline = source.endsWith('\n') ? '\n' : '';
    return { text: JSON.stringify(pkg, null, indent) + trailingNewline, changes };
}

function detectIndent(source: string): number | string {
    const m = source.match(/\n([ \t]+)"/);
    if (!m) return 2;
    if (m[1].includes('\t')) return '\t';
    return m[1].length;
}
