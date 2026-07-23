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
 * @returns {{ pkg: string, field: string, dep: string, spec: string }[]}
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
