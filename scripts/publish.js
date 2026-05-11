#!/usr/bin/env node
/**
 * publish.js — publish all non-private workspace packages in topological order.
 *
 * Usage:
 *   node scripts/publish.js                 # publish under default dist-tag (latest)
 *   node scripts/publish.js --tag beta      # publish under @beta
 *   node scripts/publish.js --dry-run       # show what would happen, no network
 *
 * Notes:
 * - Relies on `pnpm publish -r` for topological ordering and workspace ref rewrites.
 * - Refuses to run on a dirty working tree unless --allow-dirty is passed.
 * - Skips private packages automatically (`pnpm publish` honors `private: true`).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const args = process.argv.slice(2);
const tag = (args.find(a => a.startsWith('--tag='))?.split('=')[1])
    ?? (args.includes('--tag') ? args[args.indexOf('--tag') + 1] : 'latest');
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');

function run(cmd, opts = {}) {
    console.log(`\x1b[2m$ ${cmd}\x1b[0m`);
    return execSync(cmd, { stdio: 'inherit', cwd: repoRoot, ...opts });
}
function exec(cmd) {
    return execSync(cmd, { cwd: repoRoot }).toString().trim();
}

// 1. Pre-flight: working tree must be clean
if (!allowDirty) {
    const status = exec('git status --porcelain');
    if (status) {
        console.error('❌ Working tree is not clean. Commit or stash, or pass --allow-dirty.');
        console.error(status);
        process.exit(1);
    }
}

// 2. Show plan: list packages that will be published
const pkgs = JSON.parse(exec('pnpm -r ls --json --depth -1'));
const publishable = pkgs.filter(p => !p.private && p.name && !p.name.endsWith('-monorepo'));
console.log(`\nPublishing ${publishable.length} package(s) to dist-tag "${tag}"${dryRun ? ' (DRY RUN)' : ''}:\n`);
for (const p of publishable) {
    const local = JSON.parse(readFileSync(resolve(p.path, 'package.json'), 'utf8'));
    console.log(`  - ${p.name}@${local.version}`);
}
console.log('');

if (dryRun) {
    run(`pnpm publish -r --tag ${tag} --dry-run --no-git-checks`);
    console.log('\n✅ Dry run complete.');
    process.exit(0);
}

// 3. Build everything before publishing
console.log('Building all packages...');
run('pnpm -r run build');

// 4. Publish
run(`pnpm publish -r --tag ${tag} --no-git-checks --access public`);

console.log('\n✅ Publish complete.');
console.log(`Tag: ${tag}`);
console.log('Next: verify on https://www.npmjs.com and run smoke tests.');
