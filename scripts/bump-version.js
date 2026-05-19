import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const packagesDir = join(repoRoot, 'packages');

const rawArgs = process.argv.slice(2);
const force = rawArgs.includes('--force');
const positional = rawArgs.filter(a => !a.startsWith('--'));
const arg = positional[0];

if (!arg) {
    console.error('❌ Missing argument. Usage:');
    console.error('   pnpm version:patch | version:minor | version:major');
    console.error('   pnpm version:set <X.Y.Z>');
    process.exit(1);
}

// Check if arg is a version number (e.g., "0.2.0") or bump type
const isExactVersion = /^\d+\.\d+\.\d+/.test(arg);
const bumpType = isExactVersion ? null : arg;
const exactVersion = isExactVersion ? arg : null;

if (!isExactVersion && !['patch', 'minor', 'major'].includes(bumpType)) {
    console.error(`❌ Unknown bump type "${bumpType}". Expected patch|minor|major or an exact X.Y.Z version.`);
    process.exit(1);
}

function bumpVersion(version, type) {
    const parts = version.split('.').map(Number);
    switch (type) {
        case 'major':
            return `${parts[0] + 1}.0.0`;
        case 'minor':
            return `${parts[0]}.${parts[1] + 1}.0`;
        case 'patch':
        default:
            return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    }
}

function processPackages(dir) {
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
            const pkgPath = join(fullPath, 'package.json');
            try {
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                if (pkg.private) {
                    console.log(`Skipping private package: ${pkg.name}`);
                    continue;
                }
                const oldVersion = pkg.version;
                const newVersion = exactVersion || bumpVersion(oldVersion, bumpType);
                pkg.version = newVersion;
                writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
                console.log(`${pkg.name}: ${oldVersion} → ${newVersion}`);
            } catch (e) {
                // No package.json, skip
            }
        }
    }
}

function assertLockstep() {
    const versions = new Map();
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
        if (!versions.has(pkg.version)) versions.set(pkg.version, []);
        versions.get(pkg.version).push(pkg.name);
    }
    if (errors.length) {
        console.error('❌ Cannot bump — broken package(s):\n');
        for (const e of errors) console.error(e);
        console.error('\nFix the offending package(s) and re-run, or pass --force to override.');
        process.exit(1);
    }
    if (versions.size <= 1) return;
    console.error('❌ Lockstep violation: publishable packages disagree on version.\n');
    const sorted = [...versions.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [version, names] of sorted) {
        console.error(`  ${version}  (${names.length})`);
        for (const name of names.sort()) console.error(`    - ${name}`);
    }
    if (exactVersion) {
        console.error(
            `\nRun with the same target (\`pnpm version:set ${exactVersion}\`) to re-unify, or pass --force to override.`,
        );
    } else {
        console.error(
            '\nRun `pnpm version:set <X.Y.Z>` to re-unify before bumping, or pass --force to bump anyway.',
        );
    }
    process.exit(1);
}

if (!force) {
    if (exactVersion) {
        // For an explicit target, divergence is fine — that's exactly what we're fixing.
    } else {
        assertLockstep();
    }
}

if (exactVersion) {
    console.log(`Setting all packages to version ${exactVersion}...\n`);
} else {
    console.log(`Bumping ${bumpType} version for packages...\n`);
}
processPackages(packagesDir);
console.log('\nDone!');
