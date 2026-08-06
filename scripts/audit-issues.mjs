#!/usr/bin/env node
/**
 * audit-issues.mjs — create the per-package tracking issues for the module
 * review epic (signalxjs/lynx#857).
 *
 *   node scripts/audit-issues.mjs --epic 857 --dry-run   # print every body
 *   node scripts/audit-issues.mjs --epic 857             # create them
 *   node scripts/audit-issues.mjs --epic 857 --only lynx-clipboard,lynx-audio
 *
 * Re-runnable: an existing open or closed issue titled `Module review: <pkg>`
 * is left alone, so this stays usable when a 58th package lands.
 *
 * The unit list, per-package metadata and body template live in
 * `lib/audit-units.mjs` so they can be unit-tested without touching GitHub.
 */
import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildUnits, EXCLUDED, FOLD, groupUnits, renderBody, renderTitle } from './lib/audit-units.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
/**
 * Read a value-bearing flag, refusing a missing or flag-shaped value.
 *
 * This script creates GitHub issues, so a silently-undefined `--only` would
 * widen the run from two packages to all 53 — fail fast instead.
 */
const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
        console.error(`--${name} needs a value.`);
        process.exit(2);
    }
    return value;
};
const has = (name) => argv.includes(`--${name}`);

const dryRun = has('dry-run');
const epic = Number(flag('epic'));
const only = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean);

if (!Number.isInteger(epic) || epic <= 0) {
    console.error('Usage: node scripts/audit-issues.mjs --epic <issue-number> [--dry-run] [--only pkg,pkg]');
    process.exit(2);
}

// --- units ------------------------------------------------------------------

const packagesDir = join(repoRoot, 'packages');
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(packagesDir, e.name, 'package.json')))
    .map((e) => e.name);

const { units, unknown } = buildUnits(packageDirs);

// A package nobody has classified is a bug in this script, not a package to
// skip quietly — an unaudited package is exactly what this epic exists to
// prevent.
if (unknown.length > 0) {
    console.error(
        `Unclassified package(s): ${unknown.join(', ')}\n` +
            'Add them to META (or FOLD) in scripts/lib/audit-units.mjs before generating issues.',
    );
    process.exit(1);
}

const selected = only ? units.filter((u) => only.includes(u.pkg)) : units;
if (only) {
    const missing = only.filter((o) => !units.some((u) => u.pkg === o));
    if (missing.length > 0) {
        console.error(`--only names no such audit unit: ${missing.join(', ')}`);
        process.exit(1);
    }
}

// --- dry run ----------------------------------------------------------------

if (dryRun) {
    for (const unit of selected) {
        console.log(`${'='.repeat(78)}\n${renderTitle(unit)}\n${'='.repeat(78)}`);
        console.log(renderBody(unit, epic));
        console.log();
    }
    console.log(`${'-'.repeat(78)}`);
    for (const g of groupUnits(selected)) {
        console.log(`${g.title}: ${g.units.length}`);
    }
    const folded = Object.keys(FOLD).length;
    const excluded = Object.keys(EXCLUDED).length;
    console.log(
        `${selected.length} audit unit(s) from ${packageDirs.length} package directories ` +
            `(${folded} folded into a sibling, ${excluded} excluded).`,
    );
    // Name them: an excluded package is a decision, and a silent count is how
    // a decision turns back into an unexplained gap.
    for (const [name, why] of Object.entries(EXCLUDED)) console.log(`  excluded: ${name} — ${why}`);
    process.exit(0);
}

// --- create -----------------------------------------------------------------

const gh = (args) => execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

// One listing, not one lookup per package — 53 sequential `gh issue view`
// calls would take minutes and hammer the API.
const existing = new Set(
    JSON.parse(gh(['issue', 'list', '--state', 'all', '--limit', '500', '--search', 'Module review in:title', '--json', 'title']))
        .map((i) => i.title),
);

const created = [];
for (const unit of selected) {
    const title = renderTitle(unit);
    if (existing.has(title)) {
        console.log(`skip   ${unit.name} — already tracked`);
        continue;
    }
    const url = gh([
        'issue',
        'create',
        '--title',
        title,
        '--label',
        'audit',
        '--body',
        renderBody(unit, epic),
    ]);
    const number = Number(url.split('/').pop());
    created.push({ unit, number, url });
    console.log(`create ${unit.name} — ${url}`);
}

console.log(`\n${created.length} issue(s) created, ${selected.length - created.length} already tracked.`);

if (created.length > 0) {
    console.log('\nPaste into the epic checklist:\n');
    for (const g of groupUnits(created.map((c) => c.unit))) {
        if (g.units.length === 0) continue;
        console.log(`### ${g.title}`);
        for (const u of g.units) {
            const n = created.find((c) => c.unit.pkg === u.pkg).number;
            console.log(`- [ ] \`${u.name}\` (#${n})`);
        }
        console.log();
    }
}
