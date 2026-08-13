/**
 * The build shell's whole build: pull the compiled lynx artifacts out of
 * `@sigx/zero-daisyui` (the ONE recipe source, compiled by zero-kit's lynx
 * target at the skin's own build), verify the grammar envelope, bake the
 * theme metadata, and lay everything where this package ships it:
 *
 *   dist/css/…                 ← the skin's dist/lynx CSS, verbatim
 *   src/generated/theme-data.ts ← registry seeding data (hex swatches)
 *
 * Runs BEFORE tsgo (see package.json) so the generated module compiles with
 * the rest of src/.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASS_GRAMMAR_VERSION } from '@sigx/zero/contract/core';
import { generateThemeData } from './generate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Resolve through the package graph, not a hardcoded node_modules path —
// pnpm's layout owes us nothing.
const manifestPath = require.resolve('@sigx/zero-daisyui/lynx/manifest.json');
const lynxDist = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const source = generateThemeData(manifest, CLASS_GRAMMAR_VERSION);
mkdirSync(join(here, 'src', 'generated'), { recursive: true });
writeFileSync(join(here, 'src', 'generated', 'theme-data.ts'), source);

const cssOut = join(here, 'dist', 'css');
mkdirSync(cssOut, { recursive: true });
for (const entry of ['index.css', 'tokens.css', 'components']) {
    cpSync(join(lynxDist, entry), join(cssOut, entry), { recursive: true });
}

console.log(
    `[lynx-daisyui-zero] built from ${manifest.name} (grammar v${manifest.classGrammarVersion}): `
    + `${manifest.themes.length} themes, css → dist/css`,
);
