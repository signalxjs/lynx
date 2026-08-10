/**
 * `scripts/gen-theme-css.mjs` — the build step that turns a design system's
 * registered built-ins into real CSS rules (#985).
 *
 * It runs against `dist/`, so this suite drives the script end to end with a
 * throwaway themes module and asserts the emitted stylesheet, rather than
 * unit-testing pieces of it. What matters and is pinned here: both rules per
 * theme, the compound media selector that has to outrank the pinned rule, one
 * media branch per variant (never the opposite scheme), and values the Lynx
 * CSS engine can actually parse.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../gen-theme-css.mjs', import.meta.url));

let dir: string;
let css: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gen-theme-css-'));
  // A stand-in for a DS package's `dist/theme/builtins.js`: already-completed
  // themes, exactly what `completeTheme()` produces.
  await writeFile(
    join(dir, 'themes.mjs'),
    `export const TEST_THEMES = ${JSON.stringify([
      {
        name: 't-light',
        variant: 'light',
        colors: { 'primary': '#0000ff', 'base-100': '#ffffff', 'base-content': '#102030' },
      },
      {
        name: 't-dark',
        variant: 'dark',
        radius: { selector: '9px', field: '9px', box: '11px' },
        sizes: { field: '5px' },
        colors: { 'primary': '#8899ff', 'base-100': '#111111', 'base-content': '#eeeeee' },
      },
    ], null, 2)};\n`,
  );
  execFileSync(
    process.execPath,
    [SCRIPT, join(dir, 'themes.mjs'), 'TEST_THEMES', join(dir, 'out.css')],
    { stdio: 'pipe' },
  );
  css = await readFile(join(dir, 'out.css'), 'utf8');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('gen-theme-css', () => {
  it('emits a pinned rule per theme carrying palette and surface', () => {
    expect(css).toContain('.t-light {');
    expect(css).toContain('--color-primary: #0000ff;');
    // The provider's own surface is in the rule, so the CSS path can drop the
    // literal `backgroundColor`/`color` it used to declare inline.
    expect(css).toContain('background-color: #ffffff;');
    expect(css).toContain('color: #102030;');
  });

  it('scopes each theme to its own scheme, never the opposite one', () => {
    expect(css).toContain('@media (prefers-color-scheme: light) {');
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
    expect(css).toContain('.lynx-zero.scheme-light-t-light {');
    expect(css).toContain('.lynx-zero.scheme-dark-t-dark {');
    // A light theme answers for light only — there is no dark rule to pick it.
    expect(css).not.toContain('scheme-dark-t-light');
    expect(css).not.toContain('scheme-light-t-dark');
  });

  it('uses a compound selector so the media rule outranks the pinned one', () => {
    // (0,2,0) vs (0,1,0) — the engine's scheme answer must win over the theme
    // name class even though both are on the host and order could vary.
    for (const line of css.split('\n')) {
      if (line.includes('scheme-')) expect(line).toContain('.lynx-zero.');
    }
  });

  it('carries a theme\'s radius and derived size overrides', () => {
    expect(css).toContain('--radius-box: 11px;');
    expect(css).toContain('--size-field: 5px;');
    // Derived in JS, emitted as literal px — Lynx can't do calc(var() * n).
    expect(css).toContain('--size-md: 60px;');
  });

  it('emits only values the Lynx CSS engine can parse', () => {
    expect(css).not.toMatch(/oklch\(/);
    expect(css).not.toMatch(/color-mix\(/);
    // No `calc()` and no var→var indirection anywhere in the declarations.
    expect(css).not.toMatch(/calc\(/);
    expect(css).not.toMatch(/:\s*var\(/);
  });

  it('refuses a module without the named export instead of writing junk', () => {
    expect(() => execFileSync(
      process.execPath,
      [SCRIPT, join(dir, 'themes.mjs'), 'NOPE', join(dir, 'nope.css')],
      { stdio: 'pipe' },
    )).toThrow();
  });
});
