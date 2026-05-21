#!/usr/bin/env node
// Codemod: append `.js` extensions to relative import / export specifiers in
// TypeScript source files, matching upstream `@lynx-js/react`'s convention.
//
// Why: tsc/tsgo emit the import specifier verbatim into dist. Without
// extensions, Node's strict ESM resolver rejects the dist with
// ERR_MODULE_NOT_FOUND. Vite-bundled builds papered over this by
// rewriting paths at bundle time; now that worklet-shipping packages
// ship per-file tsc output (no bundler), the source needs to use the
// final, resolvable specifier.
//
// Rules per match:
//   - `./foo` where `./foo.ts(x)` exists      → `./foo.js`
//   - `./foo` where `./foo/index.ts(x)` exists → `./foo/index.js`
//   - already has an extension                → leave alone
//   - cannot resolve                          → leave alone (TS will flag)
//
// Idempotent: re-running on transformed files makes no further changes.
//
// Usage: node scripts/add-js-extensions.mjs <root1> [<root2>...]
// Example: node scripts/add-js-extensions.mjs packages/lynx-core/src packages/lynx-runtime/src

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, dirname, resolve } from 'node:path';

const SOURCE_EXTS = ['.ts', '.tsx'];
// Specifiers already carrying one of these are left untouched.
const SKIP_EXTS = new Set([
    '.js', '.jsx', '.mjs', '.cjs',
    '.json', '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.ts', '.tsx', '.d.ts',
]);

const roots = process.argv.slice(2);
if (roots.length === 0) {
    console.error('Usage: add-js-extensions.mjs <root> [<root>...]');
    process.exit(2);
}

async function walk(dir, out = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
            await walk(full, out);
        } else if (ent.isFile() && SOURCE_EXTS.includes(extname(ent.name))) {
            out.push(full);
        }
    }
    return out;
}

function specifierExt(spec) {
    // Detect a trailing extension on the specifier (after the last `/`).
    const tail = spec.slice(spec.lastIndexOf('/') + 1);
    const dot = tail.lastIndexOf('.');
    if (dot < 0) return '';
    return tail.slice(dot);
}

function resolveSpec(fromFile, spec) {
    const base = resolve(dirname(fromFile), spec);
    // Direct hit on a .ts(x) sibling.
    for (const ext of SOURCE_EXTS) {
        if (existsSync(base + ext)) return spec + '.js';
    }
    // Directory containing index.ts(x).
    if (existsSync(base) && statSync(base).isDirectory()) {
        for (const ext of SOURCE_EXTS) {
            if (existsSync(join(base, 'index' + ext))) return `${spec}/index.js`;
        }
    }
    return null;
}

// Regex finds import/export specifiers in strings:
//   import x from '<spec>'
//   import { x } from "<spec>"
//   import '<spec>'
//   export * from '<spec>'
//   export { x } from "<spec>"
// Also handles dynamic `import('<spec>')`.
// Captures the quote char and the specifier separately.
const SPEC_RE = /(\bfrom\s+|\bimport\s+|\bimport\(\s*|\bexport\s+\*\s+from\s+|\bexport\s+\{[^}]*\}\s+from\s+)(['"])((?:\\.|(?!\2).)*)\2/g;

let touched = 0;
let scanned = 0;
let total = 0;

for (const root of roots) {
    const absRoot = resolve(root);
    if (!existsSync(absRoot)) {
        console.warn(`skip (missing): ${root}`);
        continue;
    }
    const files = await walk(absRoot);
    total += files.length;
    for (const file of files) {
        scanned++;
        const src = await readFile(file, 'utf8');
        let changed = false;
        const out = src.replace(SPEC_RE, (whole, prefix, quote, spec) => {
            // Only act on relative paths.
            if (!spec.startsWith('./') && !spec.startsWith('../')) return whole;
            // Skip if already has any extension.
            if (SKIP_EXTS.has(specifierExt(spec))) return whole;
            const next = resolveSpec(file, spec);
            if (!next) return whole;
            changed = true;
            return `${prefix}${quote}${next}${quote}`;
        });
        if (changed) {
            touched++;
            await writeFile(file, out);
        }
    }
}

console.log(`add-js-extensions: scanned ${scanned}/${total} files, rewrote ${touched}`);
