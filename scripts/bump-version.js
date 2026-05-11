#!/usr/bin/env node
/**
 * bump-version.js — bump versions of all non-private workspace packages.
 *
 * Usage:
 *   node scripts/bump-version.js patch        # 0.1.0 -> 0.1.1
 *   node scripts/bump-version.js minor        # 0.1.0 -> 0.2.0
 *   node scripts/bump-version.js major        # 0.1.0 -> 1.0.0
 *   node scripts/bump-version.js 1.2.3        # set explicit version
 *   node scripts/bump-version.js 1.2.3-beta.0 # explicit pre-release
 *
 * Behavior:
 * - Updates `version` in every non-private workspace package to the same value.
 * - Leaves `workspace:^` and `workspace:*` refs untouched (pnpm rewrites them at publish time).
 * - Stages updated package.json files via `git add` (does NOT commit).
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const arg = process.argv[2];

if (!arg) {
    console.error('Usage: bump-version.js <patch|minor|major|x.y.z>');
    process.exit(2);
}

function exec(cmd) { return execSync(cmd, { cwd: repoRoot }).toString().trim(); }

const pkgs = JSON.parse(exec('pnpm -r ls --json --depth -1'))
    .filter(p => !p.private && p.name && !p.name.endsWith('-monorepo'));

if (pkgs.length === 0) {
    console.error('No non-private workspace packages found.');
    process.exit(1);
}

// Detect current version (assume all packages are version-pinned together; pick the first)
const samplePath = resolve(pkgs[0].path, 'package.json');
const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const current = sample.version;

function bumpSemver(v, kind) {
    const [maj, min, pat] = v.replace(/-.*$/, '').split('.').map(Number);
    if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
    if (kind === 'minor') return `${maj}.${min + 1}.0`;
    if (kind === 'major') return `${maj + 1}.0.0`;
    throw new Error(`Unknown bump kind: ${kind}`);
}

const next = ['patch', 'minor', 'major'].includes(arg) ? bumpSemver(current, arg) : arg;
if (!/^\d+\.\d+\.\d+(-[\w.\-]+)?$/.test(next)) {
    console.error(`Invalid version: ${next}`);
    process.exit(2);
}

console.log(`Bumping ${pkgs.length} package(s): ${current} -> ${next}\n`);
const updated = [];
for (const p of pkgs) {
    const path = resolve(p.path, 'package.json');
    const j = JSON.parse(readFileSync(path, 'utf8'));
    if (j.version === next) {
        console.log(`  =  ${j.name} (already ${next})`);
        continue;
    }
    j.version = next;
    writeFileSync(path, JSON.stringify(j, null, 2) + '\n');
    console.log(`  ✓  ${j.name}`);
    updated.push(path);
}

if (updated.length) {
    execSync(`git add ${updated.map(p => `'${p}'`).join(' ')}`, { cwd: repoRoot });
    console.log(`\nStaged ${updated.length} package.json change(s). Review, then commit:`);
    console.log(`  git commit -m "chore: release v${next}"`);
}
