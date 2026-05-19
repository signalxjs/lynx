#!/usr/bin/env node
/**
 * check-versions.js — enforce lockstep versioning across the workspace.
 *
 * Every publishable package under `packages/*` must share the exact same
 * `version`. If they diverge, exit non-zero with a diff so the developer can
 * fix the offending package(s).
 *
 * Run via `pnpm version:check`. Also runs in CI as a guardrail.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const packagesDir = join(repoRoot, 'packages');

const byVersion = new Map();
const errors = [];
for (const entry of readdirSync(packagesDir)) {
    const dir = join(packagesDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const pkgPath = join(dir, 'package.json');
    const rel = relative(repoRoot, pkgPath);
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch (err) {
        errors.push(`  ${rel}: ${err.code === 'ENOENT' ? 'missing package.json' : `unreadable / invalid JSON (${err.message})`}`);
        continue;
    }
    if (pkg.private) continue;
    if (!pkg.version) {
        errors.push(`  ${rel}: non-private package is missing "version"`);
        continue;
    }
    if (!byVersion.has(pkg.version)) byVersion.set(pkg.version, []);
    byVersion.get(pkg.version).push(pkg.name);
}

if (errors.length) {
    console.error('❌ Cannot verify lockstep — broken package(s):\n');
    for (const e of errors) console.error(e);
    process.exit(1);
}

if (byVersion.size === 0) {
    console.error('❌ No publishable packages found under packages/*.');
    process.exit(1);
}

if (byVersion.size === 1) {
    const [version] = byVersion.keys();
    const count = byVersion.get(version).length;
    console.log(`✅ ${count} publishable packages all at ${version}`);
    process.exit(0);
}

console.error('❌ Lockstep violation: publishable packages disagree on version.\n');
const sorted = [...byVersion.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [version, names] of sorted) {
    console.error(`  ${version}  (${names.length})`);
    for (const name of names.sort()) console.error(`    - ${name}`);
}
console.error('\nFix: run `pnpm version:set <X.Y.Z>` to re-unify, then commit.');
process.exit(1);
