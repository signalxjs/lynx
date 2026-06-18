#!/usr/bin/env node
/**
 * publish.js — publish all non-private workspace packages in topological order.
 *
 * Usage:
 *   node scripts/publish.js                 # publish under default dist-tag (latest)
 *   node scripts/publish.js --tag beta      # publish under @beta
 *   node scripts/publish.js --dry-run       # show what would happen, no network
 *   node scripts/publish.js --provenance    # attach npm provenance (CI/OIDC)
 *   node scripts/publish.js --allow-dirty   # bypass the clean-tree check
 *   node scripts/publish.js --only @sigx/lynx-webauth   # publish ONLY these package(s)
 *
 * Notes:
 * - `--only <name>` (repeatable, or comma-separated, or `--only=<name>`) restricts the
 *   run to the named publishable package(s) — used to bootstrap a brand-new package
 *   locally before its first CI/Trusted-Publishing release (OIDC can't first-publish a
 *   package that doesn't exist on npm yet). Run it WITHOUT `--provenance` (provenance
 *   needs OIDC); the later lockstep release publishes the rest and skips this one.
 * - Relies on `pnpm publish -r` for topological ordering and `workspace:^` rewrites.
 * - Skips private packages automatically (`pnpm publish` honors `private: true`).
 * - Already-published versions are skipped per-package via an `npm view` precheck,
 *   so partial-failure re-runs are safe.
 * - Trusted publishing (OIDC): in GitHub Actions with `permissions: id-token: write`,
 *   npm acquires the token at publish time; no NPM_TOKEN is needed.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = process.argv.slice(2);
const tag =
    args.find(a => a.startsWith('--tag='))?.split('=')[1] ??
    (args.includes('--tag') ? args[args.indexOf('--tag') + 1] : 'latest');
const dryRun = args.includes('--dry-run');
const provenance = args.includes('--provenance');
const allowDirty = args.includes('--allow-dirty');

// `--only` restricts the run to specific publishable package(s). Repeatable,
// comma-separated, and `--only=<name>` are all accepted.
const only = new Set();
let onlyFlagSeen = false;
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only') {
        onlyFlagSeen = true;
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
            next.split(',').forEach(n => n.trim() && only.add(n.trim()));
            i++;
        }
    } else if (a.startsWith('--only=')) {
        onlyFlagSeen = true;
        a.slice('--only='.length).split(',').forEach(n => n.trim() && only.add(n.trim()));
    }
}
// Fail fast rather than silently falling back to publishing EVERYTHING when
// `--only` was given without a package name (e.g. `--only --dry-run`).
if (onlyFlagSeen && only.size === 0) {
    console.error('❌ --only requires at least one package name, e.g. `--only @sigx/lynx-webauth`.');
    process.exit(1);
}

function run(cmd, opts = {}) {
    console.log(`\x1b[2m$ ${cmd}\x1b[0m`);
    return execSync(cmd, { stdio: 'inherit', cwd: repoRoot, ...opts });
}

function exec(cmd) {
    return execSync(cmd, { cwd: repoRoot }).toString().trim();
}

function isAlreadyPublished(name, version) {
    try {
        const out = execSync(`npm view ${name}@${version} version`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return out === version;
    } catch {
        return false;
    }
}

// 1. Pre-flight: working tree must be clean (unless explicitly allowed)
if (!allowDirty && !dryRun) {
    const status = exec('git status --porcelain');
    if (status) {
        console.error('❌ Working tree is not clean. Commit or stash, or pass --allow-dirty.');
        console.error(status);
        process.exit(1);
    }
}

// 2. Enumerate publishable packages from the pnpm workspace
const pkgs = JSON.parse(exec('pnpm -r ls --json --depth -1'));
let publishable = pkgs
    .filter(p => !p.private && p.name && p.path !== repoRoot)
    .map(p => {
        const local = JSON.parse(readFileSync(resolve(p.path, 'package.json'), 'utf8'));
        return { name: p.name, version: local.version, path: p.path };
    });

// `--only`: restrict to the named package(s), failing loudly on a typo.
if (only.size) {
    const known = new Set(publishable.map(p => p.name));
    const unknown = [...only].filter(n => !known.has(n));
    if (unknown.length) {
        console.error(`❌ --only: unknown publishable package(s): ${unknown.join(', ')}`);
        console.error(`   Known publishable packages:\n     ${[...known].sort().join('\n     ')}`);
        process.exit(1);
    }
    publishable = publishable.filter(p => only.has(p.name));
}

console.log(
    `\nPublishing ${publishable.length} package(s) to dist-tag "${tag}"${
        dryRun ? ' (DRY RUN)' : ''
    }${provenance ? ' [provenance]' : ''}:\n`,
);
for (const p of publishable) {
    console.log(`  - ${p.name}@${p.version}`);
}
console.log('');

// 3. Skip-list: anything already on the registry at this version
const toSkip = new Set();
if (!dryRun) {
    for (const p of publishable) {
        if (isAlreadyPublished(p.name, p.version)) {
            console.log(`⏭️  Skipping ${p.name}@${p.version} (already published)`);
            toSkip.add(p.name);
        }
    }
    if (toSkip.size) console.log('');
}

// 4. Build first so dist/ is fresh. In --only mode, build just the requested
//    package(s) and their dependencies (`...`); otherwise build everything.
if (only.size) {
    const buildFilters = [...only].map(n => `--filter "${n}..."`).join(' ');
    console.log('Building requested package(s) + dependencies...');
    run(`pnpm ${buildFilters} run build`);
} else {
    console.log('Building all packages...');
    run('pnpm -r run build');
}

// 5. Compose `pnpm publish` invocation
const baseFlags = [
    '--tag',
    tag,
    '--no-git-checks',
    '--access',
    'public',
];
if (dryRun) baseFlags.push('--dry-run');
if (provenance) baseFlags.push('--provenance');

// Double quotes, not single: execSync goes through cmd.exe on Windows,
// where single quotes are literal — pnpm would receive `'!name'` as an
// inclusion pattern matching nothing and publish zero projects.
let filterArg;
if (only.size) {
    // Positive filter: publish exactly the requested package(s), minus any
    // already on the registry at this version.
    const toPublish = publishable.filter(p => !toSkip.has(p.name));
    if (toPublish.length === 0) {
        console.log('✅ Nothing to publish — requested package(s) already published.');
        process.exit(0);
    }
    filterArg = ' ' + toPublish.map(p => `--filter "${p.name}"`).join(' ');
} else {
    const filters = [...toSkip].map(n => `--filter "!${n}"`).join(' ');
    filterArg = filters ? ` ${filters}` : '';
}

// 6. Publish
run(`pnpm${filterArg} publish -r ${baseFlags.join(' ')}`);

if (dryRun) {
    console.log('\n✅ Dry run complete.');
} else {
    console.log('\n✅ Publish complete.');
    console.log(`Tag: ${tag}`);
    console.log('Next: verify on https://www.npmjs.com and run smoke tests.');
}
