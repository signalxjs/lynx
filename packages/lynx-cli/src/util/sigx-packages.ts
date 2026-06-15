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

/**
 * The canonical list of @sigx/lynx-* packages we publish. Used by `add`
 * to catch typos in short names (`cameraa`) before they hit the registry
 * and come back as an unhelpful 404. Kept in sync with the monorepo's
 * publishable packages; the list is small and stable enough that a hard-
 * coded check is fine. Fully-qualified names (`@sigx/lynx-anything`) are
 * not validated against this — we trust the user there.
 */
export const KNOWN_SIGX_LYNX_PACKAGES: ReadonlySet<string> = new Set([
    '@sigx/lynx',
    '@sigx/lynx-camera',
    '@sigx/lynx-cli',
    '@sigx/lynx-clipboard',
    '@sigx/lynx-core',
    '@sigx/lynx-daisyui',
    '@sigx/lynx-dev-client',
    '@sigx/lynx-file-picker',
    '@sigx/lynx-file-system',
    '@sigx/lynx-gestures',
    '@sigx/lynx-haptics',
    '@sigx/lynx-http',
    '@sigx/lynx-icons',
    '@sigx/lynx-icons-fa-free',
    '@sigx/lynx-icons-lucide',
    '@sigx/lynx-image-picker',
    '@sigx/lynx-linking',
    '@sigx/lynx-location',
    '@sigx/lynx-motion',
    '@sigx/lynx-navigation',
    '@sigx/lynx-network',
    '@sigx/lynx-notifications',
    '@sigx/lynx-permissions',
    '@sigx/lynx-plugin',
    '@sigx/lynx-runtime',
    '@sigx/lynx-runtime-internal',
    '@sigx/lynx-runtime-main',
    '@sigx/lynx-safe-area',
    '@sigx/lynx-share',
    '@sigx/lynx-storage',
    '@sigx/lynx-testing',
    '@sigx/lynx-webrtc',
    '@sigx/lynx-websocket',
]);

export function isKnownSigxPackage(name: string): boolean {
    return KNOWN_SIGX_LYNX_PACKAGES.has(name);
}

/**
 * Simple Levenshtein-based suggestion for typo'd short names.
 * Returns up to 2 closest matches with distance ≤ 3.
 */
export function suggestSimilar(name: string): string[] {
    const shortName = name.startsWith(SIGX_LYNX_PREFIX) ? name.slice(SIGX_LYNX_PREFIX.length) : name;
    const candidates: Array<{ name: string; distance: number }> = [];
    for (const known of KNOWN_SIGX_LYNX_PACKAGES) {
        const knownShort = known.slice(SIGX_LYNX_PREFIX.length);
        if (!knownShort) continue;
        const distance = editDistance(shortName, knownShort);
        if (distance <= 3) candidates.push({ name: knownShort, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates.slice(0, 2).map((c) => c.name);
}

function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const prev: number[] = Array(b.length + 1).fill(0).map((_, i) => i);
    const curr: number[] = Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return curr[b.length];
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

    // Default to exact pinning — the lockstep invariant says all
    // @sigx/lynx-* packages must share one version, and an unsuspecting
    // `pnpm add @sigx/lynx-foo` on a caret range can drift the family
    // past the locked version on the next install. When the caller opts
    // into ranges (`exact: false`), keep the user's existing range style
    // per-entry instead of forcing one shape onto everything.
    const useExact = options.exact !== false;

    for (const dep of deps) {
        if (dep.isWorkspace) continue;
        // Non-semver ranges (git URLs, file:, tags) aren't safe to rewrite —
        // we don't know what shape the user wants them in.
        if (dep.version === null) continue;
        const prefix = useExact ? '' : (dep.rangePrefix || '^');
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
