/**
 * core-deps.mjs — the shared half of the catalog-sync tooling.
 *
 * `sync-core.mjs` and `check-catalog.mjs` both need to know which packages are
 * "core" and how to find core deps declared outside the catalog. They used to
 * carry their own copy of each, and the copies drifted: core shipped
 * `@sigx/serialize`, `@sigx/cloudflare`, `@sigx/vercel` and `@sigx/netlify`
 * while both lists still named ten packages, so a repo pinning any of them got
 * neither the rewrite nor the guard. One copy, here.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The packages published from signalxjs/core. Only these are rewritten by
 * `sync:core` and policed by `verify:catalog`.
 *
 * KEEP IN SYNC with `corePackages` in core's `docs/ecosystem.json` — core's CI
 * (`pnpm verify:ecosystem`) fails when a newly published package is missing
 * there, and that entry is the signal to update this list too. Also mirrored by
 * `SIGX_CORE_PACKAGES` in `@sigx/vite`.
 */
export const CORE_PACKAGES = new Set([
    'sigx',
    '@sigx/serialize',
    '@sigx/reactivity',
    '@sigx/runtime-core',
    '@sigx/runtime-dom',
    '@sigx/server-renderer',
    '@sigx/ssr-islands',
    '@sigx/resume',
    '@sigx/cache',
    '@sigx/server',
    '@sigx/vite',
    '@sigx/cloudflare',
    '@sigx/vercel',
    '@sigx/netlify',
]);

/** The dependency sections a core dep can hide in. */
export const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Where workspace packages live, across the repo shapes in this org.
 *
 * Each is checked BOTH as a container of packages (`packages/<name>/package.json`,
 * the usual shape) and as a package itself (`app/package.json`) — `signalxjs/pulse`
 * declares `- app` as a workspace entry, and scanning only one level down made its
 * inline core pins invisible to `verify:catalog`. A guard that silently sees nothing
 * is the failure this whole file exists to prevent.
 */
const WORKSPACE_DIRS = ['packages', 'app', 'apps', 'examples'];

/** Every package.json to inspect under `repoRoot`. */
export function workspaceManifests(repoRoot) {
    const files = [];
    // The ROOT manifest first. A single-package repo has no workspace dirs at all
    // (adopting.md explicitly supports that shape), and a monorepo root can still
    // declare a core dep directly — either way, skipping it would let inline pins
    // through the guard entirely. `"catalog:"` resolves in the root manifest too.
    const rootManifest = join(repoRoot, 'package.json');
    if (existsSync(rootManifest)) files.push(rootManifest);
    for (const base of WORKSPACE_DIRS) {
        const dir = join(repoRoot, base);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
        // The directory may itself be a package.
        const own = join(dir, 'package.json');
        if (existsSync(own)) files.push(own);
        // ...and/or a container of them.
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (!statSync(path).isDirectory()) continue;
            const manifest = join(path, 'package.json');
            if (existsSync(manifest)) files.push(manifest);
        }
    }
    return files;
}

/**
 * Every core dep in the repo that is declared with a literal version instead of
 * `"catalog:"` — the drift both tools care about.
 *
 * `verify:catalog` fails on these because the catalog is meant to be the one
 * source of truth. `sync:core` fails on these because it can only rewrite
 * catalog entries: a repo whose core deps are all inline has nothing for the
 * walk to match, and reporting "already aligned" there is a false green that
 * leaves the repo on the old core with no signal at all.
 *
 * @param {string} repoRoot
 * @returns {{ file: string, pkg: string, field: string, dep: string, spec: string }[]}
 */
export function findInlineCoreDeps(repoRoot) {
    const found = [];
    for (const manifest of workspaceManifests(repoRoot)) {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        for (const field of DEP_FIELDS) {
            for (const [dep, spec] of Object.entries(pkg[field] ?? {})) {
                if (CORE_PACKAGES.has(dep) && spec !== 'catalog:') {
                    found.push({ file: manifest, pkg: pkg.name ?? manifest, field, dep, spec });
                }
            }
        }
    }
    return found;
}

/** Render `findInlineCoreDeps` output as bare report lines; callers add their own bullet. */
export function formatInlineCoreDeps(hits) {
    return hits.map((h) => `${h.pkg} ${h.field}["${h.dep}"] = "${h.spec}" (must be "catalog:")`);
}

// ---------------------------------------------------------------------------
// Resolved-core guard
//
// Everything above polices what the repo DECLARES. That is only half the
// hazard: a dependency of a dependency can drag its own core line in, and no
// manifest in the repo mentions it. signalxjs/lynx sat with `@sigx/reactivity`
// 0.4.9 and 0.14.0 side by side for exactly this reason — an example pinned an
// old `@sigx/cli`, whose own `@sigx/runtime-terminal` pulled the 0.4 line —
// and every declaration-level check was (correctly) green throughout. The
// lockfile is the only place the two-copies hazard is actually visible.
// ---------------------------------------------------------------------------

/** `X.Y.Z` (ignoring any prerelease/build suffix) → `[X, Y, Z]`, or null. */
function parseVersion(version) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Does `version` satisfy the caret range `^X.Y.Z`?
 *
 * Deliberately narrow: catalog entries are validated elsewhere to be
 * single-minor carets, so caret is the only form that reaches here. Written out
 * rather than pulled from `semver` because these scripts run before/without a
 * package install in some repos, and this is the whole of the semantics we use.
 */
export function satisfiesCaret(version, range) {
    const v = parseVersion(version);
    const r = parseVersion(range.startsWith('^') ? range.slice(1) : range);
    if (!v || !r) return false;
    const [vMajor, vMinor, vPatch] = v;
    const [rMajor, rMinor, rPatch] = r;
    if (vMajor !== rMajor) return false;
    // Below 1.0.0 a caret is minor-locked (^0.14.0 admits 0.14.x, not 0.15.0),
    // and below 0.1.0 it is patch-locked. At 1.0.0 and up it admits any higher
    // minor — which still hoists as ONE copy, so it is not this guard's business.
    if (vMajor === 0 && vMinor !== rMinor) return false;
    if (vMajor === 0 && rMinor === 0) return vPatch === rPatch;
    if (vMinor !== rMinor) return vMinor > rMinor;
    return vPatch >= rPatch;
}

/**
 * The core entries of a `pnpm-workspace.yaml` catalog, as `{ name: range }`.
 *
 * Same lenient line walk `check-catalog.mjs` uses for its shape check — see the
 * comment there about column-0 comments not ending the block.
 */
export function catalogCoreRanges(workspaceYaml) {
    const entryRe = /^\s+(["']?)([@a-zA-Z0-9._/-]+)\1\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/;
    const ranges = {};
    let inCatalog = false;
    for (const line of workspaceYaml.split('\n')) {
        if (/^(catalog|catalogs)\s*:/.test(line)) { inCatalog = true; continue; }
        if (inCatalog && line.trim() !== '' && !/^\s*#/.test(line) && /^\S/.test(line)) inCatalog = false;
        if (!inCatalog) continue;
        const m = entryRe.exec(line);
        if (!m) continue;
        const name = m[2];
        if (CORE_PACKAGES.has(name)) ranges[name] = m[3] ?? m[4] ?? m[5];
    }
    return ranges;
}

/**
 * Every core package version the lockfile resolves, as `{ name: Set<version> }`.
 *
 * Reads the `packages:` section of a pnpm v9 lockfile, whose keys are
 * `'<name>@<version>'` — optionally carrying a peer-resolution suffix
 * (`'@sigx/terminal-zero@0.10.0(@sigx/reactivity@0.14.0)'`). The suffix is
 * dropped before splitting, so a peer reference is never mistaken for a
 * resolution of its own.
 */
export function lockCoreResolutions(lockYaml) {
    const found = {};
    let inPackages = false;
    for (const line of lockYaml.split('\n')) {
        if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
        if (inPackages && line.trim() !== '' && /^\S/.test(line)) inPackages = false;
        if (!inPackages) continue;
        const m = /^ {2}(["']?)(\S+?)\1\s*:\s*$/.exec(line);
        if (!m) continue;
        const id = m[2].split('(')[0];
        const at = id.lastIndexOf('@');
        if (at <= 0) continue;
        const name = id.slice(0, at);
        const version = id.slice(at + 1);
        if (!CORE_PACKAGES.has(name)) continue;
        (found[name] ??= new Set()).add(version);
    }
    return found;
}

/**
 * Core packages the lockfile resolves to something the catalog did not ask for.
 *
 * Two ways to end up with more than one copy of the reactivity graph, both
 * reported here:
 *   - a resolved version outside every catalog core range (an old line dragged
 *     in transitively), and
 *   - one core package resolved at two versions at once, even if both satisfy
 *     the range — satisfying it is not the same as being deduped to one copy.
 *
 * A repo with no catalog core entries has nothing to compare against, so it
 * reports nothing rather than guessing.
 */
export function findCoreResolutionProblems(lockYaml, catalogRanges) {
    // Deduped: a lockstep core has every catalog entry on the same range, and
    // reporting "(^0.14.0, ^0.14.0, ^0.14.0)" reads like three different rules.
    const ranges = [...new Set(Object.values(catalogRanges))];
    const problems = [];
    if (ranges.length === 0) return problems;
    for (const [name, versions] of Object.entries(lockCoreResolutions(lockYaml))) {
        const sorted = [...versions].sort();
        const stray = sorted.filter((v) => !ranges.some((r) => satisfiesCaret(v, r)));
        if (stray.length > 0) {
            problems.push(
                `${name} resolves to ${stray.map((v) => `"${v}"`).join(', ')}, outside the catalog ` +
                    `(${ranges.join(', ')}) — something depends on an older core line transitively`,
            );
        } else if (sorted.length > 1) {
            problems.push(`${name} resolves to ${sorted.length} versions at once (${sorted.join(', ')}) — one copy, or none of this works`);
        }
    }
    return problems;
}
