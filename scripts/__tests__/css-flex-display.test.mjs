import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rowRulesWithoutFlex } from '../lib/css-flex-display.mjs';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packages');

describe('rowRulesWithoutFlex', () => {
    it('flags a row rule without display: flex', () => {
        expect(rowRulesWithoutFlex('.card-actions { flex-direction: row; gap: 4px; }')).toEqual(['.card-actions']);
    });

    it('accepts display: flex in the rule, or on the base class a modifier extends', () => {
        expect(rowRulesWithoutFlex('.a { display: flex; flex-direction: row; }')).toEqual([]);
        expect(rowRulesWithoutFlex('.steps { display: flex; }\n.steps-horizontal { flex-direction: row; }')).toEqual([]);
        expect(rowRulesWithoutFlex('.x { flex-direction: column; }')).toEqual([]);
    });
});

function cssFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === 'node_modules' || e.name === 'dist') return [];
        const p = join(dir, e.name);
        if (e.isDirectory()) return cssFiles(p);
        return e.name.endsWith('.css') ? [p] : [];
    });
}

// Lynx views use linear layout unless a rule says `display: flex`, so a row
// rule without it stacks vertically on device (#508, #1136).
describe('package stylesheets', () => {
    const files = cssFiles(packagesDir).map((f) => [relative(packagesDir, f).split('\\').join('/'), f]);

    it('finds stylesheets', () => expect(files.length).toBeGreaterThan(0));

    it.each(files)('%s: every row rule sets display: flex', (_name, file) => {
        expect(rowRulesWithoutFlex(readFileSync(file, 'utf8'))).toEqual([]);
    });
});
