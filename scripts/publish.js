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
 *
 * Notes:
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
const publishable = pkgs
    .filter(p => !p.private && p.name && p.path !== repoRoot)
    .map(p => {
        const local = JSON.parse(readFileSync(resolve(p.path, 'package.json'), 'utf8'));
        return { name: p.name, version: local.version, path: p.path };
    });

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

// 4. Build everything first so dist/ is fresh
console.log('Building all packages...');
run('pnpm -r run build');

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

const filters = [...toSkip].map(n => `--filter '!${n}'`).join(' ');
const filterArg = filters ? ` ${filters}` : '';

// 6. Publish
run(`pnpm${filterArg} publish -r ${baseFlags.join(' ')}`);

if (dryRun) {
    console.log('\n✅ Dry run complete.');
} else {
    console.log('\n✅ Publish complete.');
    console.log(`Tag: ${tag}`);
    console.log('Next: verify on https://www.npmjs.com and run smoke tests.');
}
