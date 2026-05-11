#!/usr/bin/env node

/**
 * SignalX - Publish Script
 *
 * Publishes all packages in this repo to npm in dependency order.
 *
 * Usage:
 *   node scripts/publish.js [--dry-run] [--tag <tag>] [--provenance]
 *
 * Options:
 *   --dry-run     Show what would be published without actually publishing
 *   --tag         Publish with a specific tag (e.g., beta, next)
 *   --provenance  Attach an npm provenance attestation. Requires running in a
 *                 GitHub Actions workflow with `permissions: id-token: write`.
 *
 * Environment Variables:
 *   NPM_TOKEN    npm automation token. Optional — only needed for local
 *                publishing or as a fallback. CI uses npm trusted publishing
 *                (OIDC) instead, configured per-package on npmjs.com.
 *                Create at: https://www.npmjs.com/settings/<username>/tokens
 *                ("Automation" type for CI use).
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Packages in dependency order (dependencies first).
// Other SignalX packages (router, store, ssg, daisyui, runtime-terminal, etc.)
// live in their own repos under https://github.com/signalxjs and are published
// from there.
const PACKAGES = [
    'packages/reactivity',
    'packages/runtime-core',
    'packages/runtime-dom',
    'packages/sigx',
    'packages/server-renderer',
    'packages/vite',
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex !== -1 ? args[tagIndex + 1] : null;
const provenance = args.includes('--provenance');

// NPM token support for CI/CD (avoids 2FA prompts)
const NPM_TOKEN = process.env.NPM_TOKEN;
let npmrcCreated = false;
let originalNpmrc = null;
const npmrcPath = join(homedir(), '.npmrc');

function setupNpmToken() {
    if (!NPM_TOKEN) return;

    console.log('🔑 Using NPM_TOKEN for authentication\n');

    // Backup existing .npmrc if present
    if (existsSync(npmrcPath)) {
        originalNpmrc = readFileSync(npmrcPath, 'utf-8');
    }

    // Write/update token to .npmrc (always update if NPM_TOKEN is set)
    const tokenLine = `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`;
    if (originalNpmrc) {
        // Replace existing token line or append
        if (originalNpmrc.includes('//registry.npmjs.org/:_authToken=')) {
            const updated = originalNpmrc.replace(
                /\/\/registry\.npmjs\.org\/:_authToken=.*/,
                tokenLine
            );
            writeFileSync(npmrcPath, updated);
        } else {
            writeFileSync(npmrcPath, originalNpmrc + '\n' + tokenLine);
        }
        npmrcCreated = true;
    } else {
        writeFileSync(npmrcPath, tokenLine);
        npmrcCreated = true;
    }
}

function cleanupNpmToken() {
    if (!npmrcCreated) return;

    if (originalNpmrc) {
        writeFileSync(npmrcPath, originalNpmrc);
    } else {
        unlinkSync(npmrcPath);
    }
    npmrcCreated = false;
}

let signalsRegistered = false;
function registerCleanupHandlers() {
    if (signalsRegistered) return;
    signalsRegistered = true;

    const handle = (signal) => {
        try {
            cleanupNpmToken();
        } catch (err) {
            console.error('⚠️  Failed to clean up ~/.npmrc on exit:', err);
        }
        // Mirror the conventional shell exit code (128 + signal number) for SIGINT/SIGTERM.
        const code = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1;
        process.exit(code);
    };

    process.on('SIGINT', () => handle('SIGINT'));
    process.on('SIGTERM', () => handle('SIGTERM'));
    process.on('uncaughtException', (err) => {
        console.error('💥 Uncaught exception:', err);
        handle('uncaughtException');
    });
    process.on('unhandledRejection', (err) => {
        console.error('💥 Unhandled rejection:', err);
        handle('unhandledRejection');
    });
}

function getPackageInfo(packagePath) {
    const packageJsonPath = join(rootDir, packagePath, 'package.json');
    if (!existsSync(packageJsonPath)) {
        return null;
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return {
        name: packageJson.name,
        version: packageJson.version,
        path: packagePath,
    };
}

function isAlreadyPublished(name, version) {
    try {
        const result = execSync(`npm view ${name}@${version} version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return result === version;
    } catch {
        return false;
    }
}

function publishPackage(pkg) {
    const fullPath = join(rootDir, pkg.path);
    // Use pnpm publish to automatically convert workspace:^ to actual versions
    const publishCmd = dryRun
        ? 'pnpm pack --dry-run'
        : `pnpm publish --access public --no-git-checks${tag ? ` --tag ${tag}` : ''}${provenance ? ' --provenance' : ''}`;

    console.log(`\n📦 ${dryRun ? 'Would publish' : 'Publishing'}: ${pkg.name}@${pkg.version}`);
    console.log(`   Path: ${pkg.path}`);

    // Skip if already published
    if (!dryRun && isAlreadyPublished(pkg.name, pkg.version)) {
        console.log(`   ⏭️  Skipped: ${pkg.name}@${pkg.version} (already published)`);
        return 'skipped';
    }

    try {
        execSync(publishCmd, {
            cwd: fullPath,
            stdio: 'inherit'
        });
        console.log(`   ✅ ${dryRun ? 'Ready' : 'Published'}: ${pkg.name}@${pkg.version}`);
        return 'published';
    } catch (error) {
        console.error(`   ❌ Failed: ${pkg.name}`);
        return 'failed';
    }
}

async function main() {
    console.log('🚀 SignalX Publisher');
    console.log('================================');

    if (dryRun) {
        console.log('🔍 DRY RUN MODE - No packages will be published\n');
    }

    if (tag) {
        console.log(`🏷️  Publishing with tag: ${tag}\n`);
    }

    if (provenance) {
        console.log('🔏 Provenance attestations enabled\n');
    }

    // Register signal handlers BEFORE writing the token so a Ctrl+C between
    // setupNpmToken() and the cleanup in `finally` still removes the token.
    registerCleanupHandlers();

    // Setup npm token if provided
    setupNpmToken();

    // Trusted publishing (npm OIDC) acquires a token at publish time, not before.
    // Skip the whoami precheck in that mode — it would fail because no token is
    // present yet. ACTIONS_ID_TOKEN_REQUEST_TOKEN is set by GitHub Actions when
    // a job has `permissions: id-token: write`.
    const isTrustedPublishing = !NPM_TOKEN && !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

    if (isTrustedPublishing) {
        console.log('🔐 Trusted publishing (OIDC) — skipping npm whoami precheck\n');
    } else {
        try {
            const whoami = execSync('npm whoami', { encoding: 'utf-8' }).trim();
            console.log(`👤 Logged in as: ${whoami}\n`);
        } catch {
            console.error('❌ Not logged in to npm. Run: npm login');
            console.error('   Or set NPM_TOKEN environment variable');
            throw new Error('npm login required');
        }
    }

    // Build all packages first
    console.log('🔨 Building all packages...');
    try {
        execSync('pnpm run build', { cwd: rootDir, stdio: 'inherit' });
        console.log('✅ Build complete\n');
    } catch {
        throw new Error('Build failed');
    }

    // Publish packages in order
    const results = { published: [], skipped: [], failed: [] };

    for (const packagePath of PACKAGES) {
        const pkg = getPackageInfo(packagePath);
        if (!pkg) {
            console.warn(`⚠️  Skipping ${packagePath}: package.json not found`);
            continue;
        }

        const result = publishPackage(pkg);
        if (result === 'published') {
            results.published.push(pkg.name);
        } else if (result === 'skipped') {
            results.skipped.push(pkg.name);
        } else {
            results.failed.push(pkg.name);
            if (!dryRun) {
                console.error('\n⚠️  Stopping due to publish failure');
                break;
            }
        }
    }

    // Summary
    console.log('\n================================');
    console.log('📊 Summary');
    console.log('================================');
    if (results.published.length > 0) {
        console.log(`✅ ${dryRun ? 'Ready' : 'Published'}: ${results.published.length} packages`);
        console.log(`   ${results.published.join(', ')}`);
    }
    if (results.skipped.length > 0) {
        console.log(`⏭️  Skipped: ${results.skipped.length} packages (already published)`);
    }
    if (results.failed.length > 0) {
        console.log(`❌ Failed: ${results.failed.length} packages`);
        console.log(`   ${results.failed.join(', ')}`);
    }

    if (!dryRun && results.failed.length === 0) {
        console.log('\n🎉 All packages up to date!');
    }

    // Surface partial-publish failures as a non-zero exit so CI doesn't
    // mark a broken release as success — npm rejects, GH release publishes
    // anyway, npm-vs-tag drift, etc.
    if (results.failed.length > 0) {
        process.exitCode = 1;
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => {
        cleanupNpmToken();
    });
