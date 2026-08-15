/**
 * The build shell's contract (#1056): the generator bakes registry-ready
 * theme data from the skin's lynx manifest (and REFUSES a grammar-envelope
 * mismatch — CSS emitted for another grammar would silently select
 * nothing), importing the package seeds zero's registry, and the shipped
 * CSS artifacts are the skin's compiled lynx target.
 *
 * The generated module and dist CSS exist after `pnpm build` — these tests
 * read the same manifest the build reads and regenerate in-memory, so they
 * hold without a prior build where they can, and skip artifact checks
 * gracefully never: CI builds before testing, and so does the dev loop.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLASS_GRAMMAR_VERSION } from '@sigx/zero/contract/core';
import { bakeSwatch, generateThemeData } from '../generate.mjs';

const require = createRequire(import.meta.url);
const manifestPath = require.resolve('@sigx/zero-daisyui/lynx/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const HEX = /^#[0-9a-f]{6}$/;

describe('generateThemeData', () => {
    it('bakes every swatch color to hex — lynx views cannot paint oklch', () => {
        const baked = bakeSwatch({ primary: 'oklch(45% 0.24 277.023)', plain: '#ff0000' }, 'probe');
        expect(baked['primary']).toMatch(HEX);
        expect(baked['plain']).toBe('#ff0000');
        expect(() => bakeSwatch({ broken: 'not-a-color' }, 'probe'))
            .toThrow(/theme "probe" swatch role "broken"/);
    });

    it('accepts the real manifest and emits one entry per theme', () => {
        const source = generateThemeData(manifest, CLASS_GRAMMAR_VERSION);
        for (const theme of manifest.themes) expect(source).toContain(`"name": "${theme.name}"`);
        // Every baked color in the output is hex — no oklch survives.
        expect(source).not.toContain('oklch');
    });

    it('refuses a class-grammar envelope mismatch', () => {
        expect(() => generateThemeData(manifest, CLASS_GRAMMAR_VERSION + 1))
            .toThrow(/class grammar/);
        expect(() => generateThemeData({ ...manifest, target: 'web' }, CLASS_GRAMMAR_VERSION))
            .toThrow(/lynx-target manifest/);
    });
});

describe('registry seeding (import side effect)', () => {
    it('importing the package registers every daisy theme with its pairing', async () => {
        const { listThemes, getTheme, pairOf } = await import('@sigx/lynx-zero');
        // The PUBLISHED entrypoint (Node self-reference through package.json
        // exports), not ../src — so exports/sideEffects/dist wiring is under
        // test too. Needs `pnpm build` first, like the artifact checks.
        const { DAISY_THEMES } = await import('@sigx/lynx-daisyui-zero');
        const registered = new Set(listThemes().map((t) => t.name));
        for (const theme of DAISY_THEMES) {
            expect(registered.has(theme.name)).toBe(true);
        }
        expect(getTheme('light')?.colorScheme).toBe('light');
        expect(pairOf('light')).toBe('dark');
        // Swatches landed baked — a picker can paint them directly.
        for (const value of Object.values(getTheme('light')?.swatch ?? {})) {
            expect(value).toMatch(HEX);
        }
    });
});

describe('shipped artifacts', () => {
    // fileURLToPath, not URL.pathname — the latter yields "/C:/…" on Windows.
    const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

    it('ships the skin compiled lynx CSS under dist/css', () => {
        for (const file of ['css/index.css', 'css/tokens.css']) {
            expect(existsSync(join(dist, file)), `${file} missing — run pnpm build`).toBe(true);
        }
        const tokens = readFileSync(join(dist, 'css', 'tokens.css'), 'utf8');
        // The envelope in one grep each: themes are class blocks on the host
        // class, and nothing web-only leaked through the capability gate.
        expect(tokens).toContain('.zx-root');
        expect(tokens).toContain('.zx-theme-dark');
        expect(tokens).not.toMatch(/oklch\(|color-mix\(|light-dark\(/);
        const index = readFileSync(join(dist, 'css', 'index.css'), 'utf8');
        expect(index).not.toContain('@layer');
    });

    /**
     * The checks that would have caught #1029 HERE rather than on a device.
     *
     * The four greps above only ever asked whether web spellings leaked. They
     * all passed while the skin shipped 24 custom properties it used and never
     * defined, and a switch with no width, no radius and no ink — because
     * nothing asked whether the CSS was internally coherent.
     *
     * Upstream now refuses to build such a stylesheet (andtii/zero-wip#360),
     * so in the normal case these are belt-and-braces. They earn their place
     * on the day this package is pointed at an older or a hand-patched skin
     * build: the artifacts are copied in verbatim by `build.mjs`, so this is
     * the last gate before they reach an app.
     */
    describe('the CSS is internally coherent', () => {
        const index = () => readFileSync(join(dist, 'css', 'index.css'), 'utf8');
        const componentsDir = join(dist, 'css', 'components');

        it('defines every custom property it reads without a fallback', () => {
            const css = index();
            // A reference carrying its own fallback stands alone — `var(--x,
            // 8px)` paints whether or not `--x` exists — so only the HEAD of
            // such a reference is excused. The fallback text is deliberately
            // kept rather than blanked, so whatever IT reads is still checked
            // (`var(--x, var(--y))` still requires `--y`).
            const heads = css.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*,/g, '(');
            const defined = new Set([...css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map((m) => m[1]!));
            const read = new Set([...heads.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]!));
            // On lynx an unresolvable var() does not fall back — the
            // declaration is dropped and the element paints nothing at all.
            expect([...read].filter((name) => !defined.has(name)).sort()).toEqual([]);
        });

        it('gives every component a size ramp', () => {
            // Same "run pnpm build" contract as the checks above; guarded so a
            // missing dist reports that once rather than as an ENOENT here too.
            expect(existsSync(componentsDir), 'components/ missing — run pnpm build').toBe(true);
            const unsized = readdirSync(componentsDir)
                .filter((file) => file.endsWith('.css'))
                .filter((file) => !readFileSync(join(componentsDir, file), 'utf8').includes('zx-a-size-'))
                .sort();
            // `switch` shipped with none of these, which is what made it
            // render as bare text next to its label.
            expect(unsized).toEqual([]);
        });

        it('emits no CSS math lynx cannot evaluate', () => {
            // Measured on device (#1066): min() resolves neither bare nor
            // inside calc(), and the declaration carrying it is dropped
            // wholesale. `max()` and `clamp()` are the same spec feature —
            // CSS Values 4 comparison functions — and no engine ships one of
            // the three without the others, so all three are refused on that
            // evidence (andtii/zero-wip#363). calc() over var() DOES resolve
            // and is deliberately absent from this list.
            expect(index()).not.toMatch(/\bmin\(|\bmax\(|clamp\(/i);
        });
    });
});
