#!/usr/bin/env node
/**
 * check-api-conventions.mjs — CI guard (`pnpm check:conventions`).
 *
 * Enforces the mechanically-checkable parts of CONVENTIONS.md (C1–C12) as a
 * ratchet against `scripts/api-conventions-baseline.json`: new violations fail,
 * and a baseline entry that is no longer needed also fails, so the file shrinks
 * as module audits land instead of rotting.
 *
 *   node scripts/check-api-conventions.mjs                    # check
 *   node scripts/check-api-conventions.mjs --update-baseline  # re-record
 *
 * Rules live in `lib/api-conventions.mjs`; this file is the filesystem walk and
 * the reporting.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkPackage, diffAgainstBaseline, toBaseline } from './lib/api-conventions.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(repoRoot, 'packages');
const baselinePath = join(repoRoot, 'scripts', 'api-conventions-baseline.json');

const updateBaseline = process.argv.includes('--update-baseline');

/** Every `.ts`/`.tsx` under a directory, recursively. */
function collectSources(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectSources(full));
        else if (/\.tsx?$/.test(entry.name)) {
            out.push({ path: relative(repoRoot, full), source: readFileSync(full, 'utf8') });
        }
    }
    return out;
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const found = {};
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    if (!existsSync(join(dir, 'package.json'))) continue;

    const srcDir = join(dir, 'src');
    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) continue;

    const violations = checkPackage({
        dir: entry.name,
        indexSource: read(join(srcDir, 'index.ts')),
        sources: collectSources(srcDir),
        readme: read(join(dir, 'README.md')),
        isNativeModule: existsSync(join(dir, 'signalx-module.json')),
    });
    // Every package gets a key, even with no violations — diffAgainstBaseline
    // needs it to tell "clean now" from "package deleted".
    found[entry.name] = violations;
}

if (updateBaseline) {
    const next = toBaseline(found);
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 4)}\n`);
    const total = Object.values(next).reduce((n, v) => n + v.length, 0);
    console.log(`Wrote ${relative(repoRoot, baselinePath)} — ${total} entries across ${Object.keys(next).length} packages.`);
    process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const { added, stale, unknown } = diffAgainstBaseline(found, baseline);

if (added.length > 0) {
    console.error('New API-convention violations (see CONVENTIONS.md):\n');
    for (const v of added) console.error(`  ${v.pkg}  ${v.rule}  ${v.detail}`);
    console.error('');
}
if (stale.length > 0) {
    console.error('Baseline entries that are no longer needed — update the baseline in this PR:\n');
    for (const v of stale) console.error(`  ${v.pkg}  ${v.rule}  ${v.detail}`);
    console.error('\n  node scripts/check-api-conventions.mjs --update-baseline\n');
}
if (unknown.length > 0) {
    console.error('Baseline entries for packages that no longer exist:\n');
    for (const v of unknown) console.error(`  ${v.pkg}`);
    console.error('');
}

if (added.length + stale.length + unknown.length > 0) process.exit(1);

const remaining = Object.values(baseline).reduce((n, v) => n + v.length, 0);
console.log(
    `API conventions OK — no new violations. ${remaining} known violation(s) remain in the baseline, ` +
        'most owned by a module review issue (epic #857); the rest belong to packages '
        + 'excluded from the review — see EXCLUDED in scripts/lib/audit-units.mjs.',
);
