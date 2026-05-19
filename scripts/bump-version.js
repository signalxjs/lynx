import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, '..', 'packages');

const rawArgs = process.argv.slice(2);
const force = rawArgs.includes('--force');
const positional = rawArgs.filter(a => !a.startsWith('--'));
const arg = positional[0] || 'patch';

// Check if arg is a version number (e.g., "0.2.0") or bump type
const isExactVersion = /^\d+\.\d+\.\d+/.test(arg);
const bumpType = isExactVersion ? null : arg;
const exactVersion = isExactVersion ? arg : null;

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
    for (const entry of readdirSync(packagesDir)) {
        const pkgPath = join(packagesDir, entry, 'package.json');
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            if (pkg.private || !pkg.version) continue;
            if (!versions.has(pkg.version)) versions.set(pkg.version, []);
            versions.get(pkg.version).push(pkg.name);
        } catch {
            // no package.json, skip
        }
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
