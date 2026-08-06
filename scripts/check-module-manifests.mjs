#!/usr/bin/env node
/**
 * check-module-manifests.mjs — CI guard (`pnpm check:manifests`).
 *
 * Cross-checks every native module's method names across JS call sites, the
 * `signalx-module.json` manifest, the Swift `methodLookup` and the Kotlin
 * `@LynxMethod` annotations (CONVENTIONS.md C12).
 *
 *   node scripts/check-module-manifests.mjs
 *   node scripts/check-module-manifests.mjs --update-baseline
 *
 * Same ratchet as check-api-conventions.mjs: existing drift is recorded in
 * `scripts/module-manifests-baseline.json` and owned by module review issues;
 * new drift fails, and a stale baseline entry fails too so the file shrinks.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkModule, jsCalledMethods, kotlinMethods, swiftLookupMethods } from './lib/module-manifests.mjs';
import { diffAgainstBaseline, toBaseline } from './lib/api-conventions.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(repoRoot, 'packages');
const baselinePath = join(repoRoot, 'scripts', 'module-manifests-baseline.json');

const updateBaseline = process.argv.includes('--update-baseline');

function collect(dir, test) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collect(full, test));
        else if (test(entry.name)) out.push(readFileSync(full, 'utf8'));
    }
    return out;
}

const union = (sets) => new Set(sets.flatMap((s) => [...s]));

const found = {};
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifestPath = join(dir, 'signalx-module.json');
    // Only native modules have four places to disagree.
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const iosDir = join(dir, 'ios');
    const androidDir = join(dir, 'android');

    found[entry.name] = checkModule({
        declared: manifest.ios?.methods ?? [],
        called: union(collect(join(dir, 'src'), (n) => /\.tsx?$/.test(n)).map(jsCalledMethods)),
        swift: union(collect(iosDir, (n) => n.endsWith('.swift')).map(swiftLookupMethods)),
        kotlin: union(collect(androidDir, (n) => n.endsWith('.kt')).map(kotlinMethods)),
        hasIos: existsSync(iosDir),
        hasAndroid: existsSync(androidDir),
    });
}

if (updateBaseline) {
    const next = toBaseline(found);
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 4)}\n`);
    const total = Object.values(next).reduce((n, v) => n + v.length, 0);
    console.log(`Wrote ${relative(repoRoot, baselinePath)} — ${total} entries across ${Object.keys(next).length} modules.`);
    process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
const { added, stale, unknown } = diffAgainstBaseline(found, baseline);

if (added.length > 0) {
    console.error('New module-manifest drift (see CONVENTIONS.md C12):\n');
    for (const v of added) console.error(`  ${v.pkg}  ${v.rule}  ${v.detail}`);
    console.error('');
}
if (stale.length > 0) {
    console.error('Baseline entries that are no longer needed — update the baseline in this PR:\n');
    for (const v of stale) console.error(`  ${v.pkg}  ${v.rule}  ${v.detail}`);
    console.error('\n  node scripts/check-module-manifests.mjs --update-baseline\n');
}
if (unknown.length > 0) {
    console.error('Baseline entries for modules that no longer exist:\n');
    for (const v of unknown) console.error(`  ${v.pkg}`);
    console.error('');
}

if (added.length + stale.length + unknown.length > 0) process.exit(1);

const remaining = Object.values(baseline).reduce((n, v) => n + v.length, 0);
console.log(
    `Module manifests OK — no new drift. ${remaining} known drift(s) remain in the baseline, ` +
        'most owned by a module review issue (epic #857); the rest belong to packages '
        + 'excluded from the review — see EXCLUDED in scripts/lib/audit-units.mjs.',
);
