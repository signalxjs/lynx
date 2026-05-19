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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, '..', 'packages');

const byVersion = new Map();
for (const entry of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, entry, 'package.json');
    let pkg;
    try {
        if (!statSync(join(packagesDir, entry)).isDirectory()) continue;
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
        continue;
    }
    if (pkg.private) continue;
    if (!pkg.version) continue;
    if (!byVersion.has(pkg.version)) byVersion.set(pkg.version, []);
    byVersion.get(pkg.version).push(pkg.name);
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
