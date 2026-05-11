import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packagesDir = join(__dirname, '..', 'packages');

const arg = process.argv[2] || 'patch';

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

if (exactVersion) {
    console.log(`Setting all packages to version ${exactVersion}...\n`);
} else {
    console.log(`Bumping ${bumpType} version for packages...\n`);
}
processPackages(packagesDir);
console.log('\nDone!');
