#!/usr/bin/env node
/**
 * check-catalog.mjs — CI guard (`pnpm verify:catalog`). Fails if:
 *   1. any workspace package declares a CORE dep with an inline version instead
 *      of `"catalog:"` (drift — the whole point is one source of truth),
 *   2. a `catalog:` core entry is NOT a single-minor caret `^X.Y.0`
 *      (a wider range like `>=0.11 <0.13` re-opens the two-copies hazard), or
 *   3. the LOCKFILE resolves a core package outside the catalog, or at two
 *      versions at once. 1 and 2 police what the repo declares; only 3 sees a
 *      core line dragged in transitively by a dependency of a dependency.
 *
 * Wire into ci.yml. Generalises lynx's check-versions.js to the catalog model.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    catalogCoreRanges,
    findCoreResolutionProblems,
    findInlineCoreDeps,
    formatInlineCoreDeps,
} from './lib/core-deps.mjs';

const SINGLE_MINOR = /^\^\d+\.\d+\.0$/; // ^X.Y.0 — one minor

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

// 1. Every core dep in every package.json must be exactly "catalog:".
errors.push(...formatInlineCoreDeps(findInlineCoreDeps(repoRoot)));

// 2. Catalog core entries must be single-minor caret. `catalogCoreRanges` does
//    the lenient pnpm-workspace.yaml walk (quoted or bare values, column-0
//    comments not ending the block) and part 3 needs the same entries, so the
//    walk lives in the shared lib — one parser, one answer about what the
//    catalog says. A repo with no workspace file has no catalog to police.
const wsPath = join(repoRoot, 'pnpm-workspace.yaml');
const ws = existsSync(wsPath) ? readFileSync(wsPath, 'utf8') : '';
const coreRanges = catalogCoreRanges(ws);
for (const [name, ver] of Object.entries(coreRanges)) {
    if (!SINGLE_MINOR.test(ver)) {
        errors.push(`catalog["${name}"] = "${ver}" (must be single-minor ^X.Y.0 to keep one copy hoisted)`);
    }
}

// 3. The lockfile must not resolve a core package the catalog did not ask for.
//    A repo without a lockfile (a fresh clone, a consumer of this script that
//    uses another package manager) has nothing to check — skip rather than fail.
const lockPath = join(repoRoot, 'pnpm-lock.yaml');
if (existsSync(lockPath)) {
    errors.push(...findCoreResolutionProblems(readFileSync(lockPath, 'utf8'), coreRanges));
}

if (errors.length) {
    console.error('verify:catalog FAILED:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
}
console.log('verify:catalog OK — all core deps go through a single-minor catalog, and the lockfile resolves one core line.');
