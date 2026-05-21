#!/usr/bin/env node
// One-shot migration: convert lynx-* package.json from
// `vite build && tsgo --emitDeclarationOnly` to `tsgo`-only emit.
//
// For each package:
//   - Replace build / dev / prepublishOnly scripts.
//   - Preserve any trailing copy-assets step (lynx-daisyui, lynx-icons).
//   - Ensure a `clean` script using scripts/clean.mjs.
//   - Remove `vite` and `@sigx/vite` from devDependencies.
//   - Ensure `@typescript/native-preview` is in devDependencies.
//   - Delete vite.config.ts next to the package.json.
//
// Idempotent: skips packages already on tsgo-only.

import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TSC_NATIVE_VERSION = '7.0.0-dev.20260511.1';

const paths = process.argv.slice(2);
if (paths.length === 0) {
    console.error('Usage: migrate-to-tsgo.mjs <pkg-dir> [<pkg-dir>...]');
    process.exit(2);
}

function rewriteBuildScript(script) {
    if (!script) return script;
    // Match leading `vite build && tsgo --emitDeclarationOnly` and replace
    // with the tsgo-only equivalent, preserving any trailing post-build step
    // (e.g. ` && node ../../scripts/copy-assets.mjs src/styles dist/styles`).
    return script.replace(
        /^vite build\s+&&\s+tsgo --emitDeclarationOnly/,
        'node ../../scripts/clean.mjs dist && tsgo',
    );
}

function rewriteDevScript(script) {
    if (!script) return script;
    return script.replace(/^vite build --watch$/, 'tsgo --watch');
}

let touched = 0;

for (const pkgDir of paths) {
    const abs = resolve(pkgDir);
    const pkgJsonPath = join(abs, 'package.json');
    if (!existsSync(pkgJsonPath)) {
        console.warn(`skip (no package.json): ${pkgDir}`);
        continue;
    }
    const raw = await readFile(pkgJsonPath, 'utf8');
    const pkg = JSON.parse(raw);

    const beforeScripts = JSON.stringify(pkg.scripts ?? {});

    pkg.scripts ??= {};
    if (pkg.scripts.build) {
        pkg.scripts.build = rewriteBuildScript(pkg.scripts.build);
    }
    if (pkg.scripts.dev) {
        pkg.scripts.dev = rewriteDevScript(pkg.scripts.dev);
    }
    if (pkg.scripts.prepublishOnly) {
        pkg.scripts.prepublishOnly = rewriteBuildScript(pkg.scripts.prepublishOnly);
    }
    if (!pkg.scripts.clean) {
        pkg.scripts.clean = 'node ../../scripts/clean.mjs dist .turbo';
    }

    const beforeDeps = JSON.stringify(pkg.devDependencies ?? {});

    if (pkg.devDependencies) {
        delete pkg.devDependencies['vite'];
        delete pkg.devDependencies['@sigx/vite'];
        if (!pkg.devDependencies['@typescript/native-preview']) {
            // Insert alphabetically with the existing devDeps, then resort.
            pkg.devDependencies['@typescript/native-preview'] = TSC_NATIVE_VERSION;
            pkg.devDependencies = Object.fromEntries(
                Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)),
            );
        }
    }

    const afterScripts = JSON.stringify(pkg.scripts);
    const afterDeps = JSON.stringify(pkg.devDependencies ?? {});

    const changed = beforeScripts !== afterScripts || beforeDeps !== afterDeps;
    if (!changed) {
        console.log(`unchanged: ${pkg.name}`);
        continue;
    }

    // Write back preserving 4-space indent (the workspace convention).
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 4) + '\n');

    // Delete vite.config.ts if it exists.
    const viteConfig = join(abs, 'vite.config.ts');
    if (existsSync(viteConfig)) {
        await rm(viteConfig);
        console.log(`migrated: ${pkg.name} (deleted vite.config.ts)`);
    } else {
        console.log(`migrated: ${pkg.name}`);
    }
    touched++;
}

console.log(`migrate-to-tsgo: rewrote ${touched} package(s)`);
